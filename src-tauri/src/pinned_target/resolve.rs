//! Bounded, unique resolution within the original retained window.
use super::PinFailure;

pub(super) const MAX_NODES: usize = 500;
const MAX_DEPTH: usize = 12;

pub(super) trait SearchTree {
    type Element: Clone;
    fn children(
        &mut self,
        element: &Self::Element,
        remaining: usize,
    ) -> Result<Vec<Self::Element>, PinFailure>;
    fn matches(&mut self, element: &Self::Element) -> Result<bool, PinFailure>;
}

pub(super) fn unique_match<T: SearchTree>(
    tree: &mut T,
    root: T::Element,
) -> Result<T::Element, PinFailure> {
    let mut stack = vec![(root, 0)];
    let mut seen = 0;
    let mut found = None;
    while let Some((element, depth)) = stack.pop() {
        if seen >= MAX_NODES {
            return Err(PinFailure::TimedOut);
        }
        seen += 1;
        if tree.matches(&element)? {
            if found.is_some() {
                return Err(PinFailure::Ambiguous);
            }
            found = Some(element.clone());
        }
        let children = tree.children(&element, MAX_NODES - seen)?;
        if depth == MAX_DEPTH && !children.is_empty() {
            return Err(PinFailure::TimedOut);
        }
        if children.len() + stack.len() > MAX_NODES - seen {
            return Err(PinFailure::TimedOut);
        }
        stack.extend(children.into_iter().map(|e| (e, depth + 1)));
    }
    found.ok_or(PinFailure::NotFound)
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Tree {
        children: Vec<Vec<usize>>,
        matches: Vec<usize>,
    }
    impl SearchTree for Tree {
        type Element = usize;
        fn children(&mut self, e: &usize, _: usize) -> Result<Vec<usize>, PinFailure> {
            Ok(self.children[*e].clone())
        }
        fn matches(&mut self, e: &usize) -> Result<bool, PinFailure> {
            Ok(self.matches.contains(e))
        }
    }
    #[test]
    fn a_unique_identifier_resolves() {
        let mut t = Tree {
            children: vec![vec![1, 2], vec![], vec![]],
            matches: vec![2],
        };
        assert_eq!(unique_match(&mut t, 0), Ok(2));
    }
    #[test]
    fn duplicate_identifiers_fail_closed() {
        let mut t = Tree {
            children: vec![vec![1, 2], vec![], vec![]],
            matches: vec![1, 2],
        };
        assert_eq!(unique_match(&mut t, 0), Err(PinFailure::Ambiguous));
    }
    #[test]
    fn truncated_search_never_treats_first_hit_as_unique() {
        let mut t = Tree {
            children: vec![(1..=MAX_NODES).collect()],
            matches: vec![0],
        };
        assert_eq!(unique_match(&mut t, 0), Err(PinFailure::TimedOut));
    }
}
