//! All retained Accessibility objects are created, used and released on one worker.
use super::write::{TextField, WriteOutcome};
use super::*;
use accessibility_sys::*;
use core_foundation::{
    array::CFArray,
    base::{CFEqual, CFRange, CFType, TCFType},
    boolean::CFBoolean,
    string::CFString,
};
use objc::{class, msg_send, sel, sel_impl};
use std::sync::atomic::AtomicBool;
use std::{
    collections::HashMap,
    ffi::{c_void, CStr},
    time::{Duration, Instant},
};

#[derive(Clone)]
struct Element(CFType);
impl Element {
    fn raw(&self) -> AXUIElementRef {
        self.0.as_CFTypeRef() as _
    }
    fn equal(&self, other: &Self) -> bool {
        unsafe { CFEqual(self.0.as_CFTypeRef(), other.0.as_CFTypeRef()) != 0 }
    }
}
struct Budget(Instant);
impl Budget {
    fn new() -> Self {
        Self(Instant::now() + Duration::from_millis(1500))
    }
    fn prepare(&self, element: &Element) -> Result<(), PinFailure> {
        let remaining = self
            .0
            .saturating_duration_since(Instant::now())
            .as_secs_f32();
        if remaining <= 0.0 {
            return Err(PinFailure::TimedOut);
        }
        check(unsafe { AXUIElementSetMessagingTimeout(element.raw(), remaining.min(0.15)) })
    }
}
fn check(error: i32) -> Result<(), PinFailure> {
    if error == 0 {
        Ok(())
    } else {
        Err(match error {
            -25204 => PinFailure::TimedOut,
            -25211 => PinFailure::NoPermission,
            -25202 => PinFailure::NotFound,
            _ => PinFailure::NotSettable,
        })
    }
}
fn attr(element: &Element, name: &str, budget: &Budget) -> Result<CFType, PinFailure> {
    budget.prepare(element)?;
    let key = CFString::new(name);
    let mut raw = std::ptr::null();
    check(unsafe {
        AXUIElementCopyAttributeValue(element.raw(), key.as_concrete_TypeRef(), &mut raw)
    })?;
    if raw.is_null() {
        return Err(PinFailure::NotFound);
    }
    Ok(unsafe { CFType::wrap_under_create_rule(raw) })
}
fn string(element: &Element, name: &str, budget: &Budget) -> Option<String> {
    attr(element, name, budget)
        .ok()
        .and_then(|v| v.downcast_into::<CFString>())
        .map(|s| s.to_string())
}
fn element_attr(element: &Element, name: &str, budget: &Budget) -> Result<Element, PinFailure> {
    let value = attr(element, name, budget)?;
    if value.type_of() != unsafe { AXUIElementGetTypeID() } {
        return Err(PinFailure::NotFound);
    }
    Ok(Element(value))
}
fn array(
    element: &Element,
    name: &str,
    max: usize,
    budget: &Budget,
) -> Result<Vec<Element>, PinFailure> {
    budget.prepare(element)?;
    let key = CFString::new(name);
    let mut count = 0;
    let error = unsafe {
        AXUIElementGetAttributeValueCount(element.raw(), key.as_concrete_TypeRef(), &mut count)
    };
    if error == -25205 || error == -25212 {
        return Ok(Vec::new());
    }
    check(error)?;
    if count < 0 || count as usize > max {
        return Err(PinFailure::TimedOut);
    }
    if count == 0 {
        return Ok(Vec::new());
    }
    budget.prepare(element)?;
    let mut raw = std::ptr::null();
    check(unsafe {
        AXUIElementCopyAttributeValues(element.raw(), key.as_concrete_TypeRef(), 0, count, &mut raw)
    })?;
    if raw.is_null() {
        return Err(PinFailure::NotFound);
    }
    let values: CFArray<CFType> = unsafe { CFArray::wrap_under_create_rule(raw) };
    let mut result = Vec::new();
    for item in values.iter() {
        let value = (*item).clone();
        if value.type_of() == unsafe { AXUIElementGetTypeID() } {
            result.push(Element(value));
        }
    }
    Ok(result)
}
fn settable(element: &Element, name: &str, budget: &Budget) -> bool {
    if budget.prepare(element).is_err() {
        return false;
    }
    let key = CFString::new(name);
    let mut result = 0;
    unsafe {
        AXUIElementIsAttributeSettable(element.raw(), key.as_concrete_TypeRef(), &mut result) == 0
            && result != 0
    }
}
fn set(element: &Element, name: &str, value: &CFType, budget: &Budget) -> Result<(), PinFailure> {
    budget.prepare(element)?;
    let key = CFString::new(name);
    check(unsafe {
        AXUIElementSetAttributeValue(
            element.raw(),
            key.as_concrete_TypeRef(),
            value.as_CFTypeRef(),
        )
    })
}
fn app_element(pid: i32) -> Result<Element, PinFailure> {
    let raw = unsafe { AXUIElementCreateApplication(pid) };
    if raw.is_null() {
        return Err(PinFailure::AppGone);
    }
    Ok(Element(unsafe { CFType::wrap_under_create_rule(raw as _) }))
}
fn objc_string(object: *mut objc::runtime::Object) -> Option<String> {
    if object.is_null() {
        return None;
    }
    let raw: *const std::os::raw::c_char = unsafe { msg_send![object, UTF8String] };
    (!raw.is_null()).then(|| {
        unsafe { CStr::from_ptr(raw) }
            .to_string_lossy()
            .into_owned()
    })
}
fn process(pid: Option<i32>) -> Option<(i32, String, String, f64)> {
    objc::rc::autoreleasepool(|| unsafe {
        let running: *mut objc::runtime::Object = if let Some(pid) = pid {
            msg_send![class!(NSRunningApplication),runningApplicationWithProcessIdentifier:pid]
        } else {
            let workspace: *mut objc::runtime::Object =
                msg_send![class!(NSWorkspace), sharedWorkspace];
            msg_send![workspace, frontmostApplication]
        };
        if running.is_null() {
            return None;
        }
        let terminated: bool = msg_send![running, isTerminated];
        if terminated {
            return None;
        }
        let pid: i32 = msg_send![running, processIdentifier];
        let bundle: *mut objc::runtime::Object = msg_send![running, bundleIdentifier];
        let name: *mut objc::runtime::Object = msg_send![running, localizedName];
        let launch: *mut objc::runtime::Object = msg_send![running, launchDate];
        if launch.is_null() {
            return None;
        }
        let born: f64 = msg_send![launch, timeIntervalSince1970];
        Some((
            pid,
            objc_string(bundle)?,
            objc_string(name).unwrap_or_else(|| "Application".into()),
            born,
        ))
    })
}
pub(super) fn frontmost_pid() -> Option<i32> {
    process(None).map(|p| p.0)
}
fn document(element: &Element, window: &Element, budget: &Budget) -> Option<String> {
    let mut current = element.clone();
    for _ in 0..12 {
        if let Some(value) =
            string(&current, "AXURL", budget).or_else(|| string(&current, "AXDocument", budget))
        {
            return Some(value);
        }
        // AXURL is often a CFURL, rather than a string.
        if let Ok(value) = attr(&current, "AXURL", budget) {
            if let Some(url) = value.downcast_into::<core_foundation::url::CFURL>() {
                return Some(url.get_string().to_string());
            }
        }
        if current.equal(window) {
            break;
        }
        let Ok(parent) = element_attr(&current, "AXParent", budget) else {
            break;
        };
        current = parent;
    }
    string(window, "AXDocument", budget)
}
fn locator(
    element: &Element,
    window: &Element,
    budget: &Budget,
) -> Result<FieldLocator, PinFailure> {
    let role = string(element, "AXRole", budget).ok_or(PinFailure::NotFound)?;
    let subrole = string(element, "AXSubrole", budget);
    if !matches!(role.as_str(), "AXTextField" | "AXTextArea" | "AXComboBox")
        || subrole.as_deref() == Some("AXSecureTextField")
        || attr(element, "AXProtectedContent", budget)
            .ok()
            .and_then(|v| v.downcast_into::<CFBoolean>())
            .is_some_and(bool::from)
    {
        return Err(PinFailure::NotSettable);
    }
    let label = string(element, "AXTitle", budget)
        .filter(|v| !v.is_empty())
        .or_else(|| string(element, "AXDescription", budget).filter(|v| !v.is_empty()))
        .or_else(|| string(element, "AXPlaceholderValue", budget).filter(|v| !v.is_empty()))
        .unwrap_or_else(|| "Text field".into());
    let identifier = string(element, "AXIdentifier", budget).filter(|s| !s.is_empty());
    let document = document(element, window, budget);
    let window_title = string(window, "AXTitle", budget);
    budget.prepare(element)?;
    Ok(FieldLocator {
        role,
        subrole,
        identifier,
        label,
        document,
        window_title,
    })
}

struct Cached {
    target: PinnedTarget,
    born: f64,
    app: Element,
    window: Element,
    field: Element,
}
#[derive(Default)]
pub(super) struct Backend {
    cache: HashMap<String, Cached>,
}
impl Backend {
    pub fn clear_before(&mut self, generation: u64) {
        self.cache
            .retain(|_, cached| cached.target.generation >= generation);
    }
    pub fn capture(
        &mut self,
        generation: u64,
        pid: Option<i32>,
    ) -> Result<PinnedTarget, PinFailure> {
        if !unsafe { AXIsProcessTrusted() } {
            return Err(PinFailure::NoPermission);
        }
        let (pid, bundle_id, app_name, born) =
            process(Some(pid.ok_or(PinFailure::AppGone)?)).ok_or(PinFailure::AppGone)?;
        if pid == std::process::id() as i32 || bundle_id.starts_with("com.iriedinamik.voxjot") {
            return Err(PinFailure::NotSettable);
        }
        let budget = Budget::new();
        let app = app_element(pid)?;
        let field = element_attr(&app, "AXFocusedUIElement", &budget)?;
        let mut field_pid = 0;
        check(unsafe { AXUIElementGetPid(field.raw(), &mut field_pid) })?;
        if field_pid != pid {
            return Err(PinFailure::NotFound);
        }
        let window = element_attr(&field, "AXWindow", &budget)?;
        let field_locator = locator(&field, &window, &budget)?;
        if !settable(&field, "AXSelectedText", &budget)
            || !settable(&field, "AXSelectedTextRange", &budget)
        {
            return Err(PinFailure::NotSettable);
        }
        let value = attr(&field, "AXValue", &budget)?
            .downcast_into::<CFString>()
            .ok_or(PinFailure::NotSettable)?;
        if value.to_string().len() > write::MAX_FIELD_BYTES {
            return Err(PinFailure::TooLarge);
        }
        let target = PinnedTarget {
            id: Uuid::new_v4().to_string(),
            generation,
            pid,
            bundle_id,
            app_name,
            pinned_at: chrono::Utc::now().timestamp(),
            locator: field_locator,
        };
        self.cache.insert(
            target.id.clone(),
            Cached {
                target: target.clone(),
                born,
                app,
                window,
                field,
            },
        );
        Ok(target)
    }
    pub fn resolve(&mut self, target: &PinnedTarget) -> Result<Field, PinFailure> {
        self.resolve_for_mode(target, true)
    }
    fn resolve_for_mode(
        &mut self,
        target: &PinnedTarget,
        background_write: bool,
    ) -> Result<Field, PinFailure> {
        if !unsafe { AXIsProcessTrusted() } {
            return Err(PinFailure::NoPermission);
        }
        let cached = self.cache.get_mut(&target.id).ok_or(PinFailure::NotFound)?;
        let (_, bundle, _, born) = process(Some(target.pid)).ok_or(PinFailure::AppGone)?;
        if born != cached.born || bundle != target.bundle_id {
            return Err(PinFailure::AppGone);
        }
        let budget = Budget::new();
        if !array(&cached.app, "AXWindows", 64, &budget)?
            .iter()
            .any(|w| w.equal(&cached.window))
        {
            return Err(PinFailure::NotFound);
        }
        let matches = |field: &Element, budget: &Budget| -> bool {
            element_attr(field, "AXWindow", budget).is_ok_and(|w| w.equal(&cached.window))
                && locator(field, &cached.window, budget).is_ok_and(|l| {
                    l.role == target.locator.role
                        && l.subrole == target.locator.subrole
                        && l.identifier == target.locator.identifier
                        && l.document == target.locator.document
                        && (l.document.is_some() || l.window_title == target.locator.window_title)
                        && l.label == target.locator.label
                })
        };
        let field = if matches(&cached.field, &budget) {
            cached.field.clone()
        } else {
            // Rebuilt controls need a stable identifier. A title/path/hash alone
            // cannot prove that this is the same browser tab or destination.
            if target.locator.identifier.is_none() {
                return Err(PinFailure::NotFound);
            }
            struct Tree<'a> {
                budget: &'a Budget,
                cached: &'a Cached,
            }
            impl resolve::SearchTree for Tree<'_> {
                type Element = Element;
                fn children(
                    &mut self,
                    e: &Element,
                    left: usize,
                ) -> Result<Vec<Element>, PinFailure> {
                    array(e, "AXChildren", left, self.budget)
                }
                fn matches(&mut self, e: &Element) -> Result<bool, PinFailure> {
                    self.budget.prepare(e)?;
                    if string(e, "AXIdentifier", self.budget)
                        != self.cached.target.locator.identifier
                    {
                        return Ok(false);
                    }
                    Ok(locator(e, &self.cached.window, self.budget)
                        .is_ok_and(|l| l == self.cached.target.locator))
                }
            }
            let mut tree = Tree {
                budget: &budget,
                cached,
            };
            resolve::unique_match(&mut tree, cached.window.clone())?
        };
        if background_write
            && (!settable(&field, "AXSelectedText", &budget)
                || !settable(&field, "AXSelectedTextRange", &budget))
        {
            return Err(PinFailure::NotSettable);
        }
        cached.field = field.clone();
        Ok(Field {
            element: field,
            window: cached.window.clone(),
            app: cached.app.clone(),
            target: target.clone(),
            born: cached.born,
            verify_after_write: false,
        })
    }
    pub fn open(&mut self, target: &PinnedTarget) -> Result<(), PinFailure> {
        // Explicit recovery may activate the original process, but never relaunch
        // a different process or infer a new destination from its bundle name.
        let cached = self.cache.get(&target.id).ok_or(PinFailure::NotFound)?;
        let (_, bundle, _, born) = process(Some(target.pid)).ok_or(PinFailure::AppGone)?;
        if born != cached.born || bundle != target.bundle_id {
            return Err(PinFailure::AppGone);
        }
        objc::rc::autoreleasepool(|| unsafe {
            let running: *mut objc::runtime::Object = msg_send![class!(NSRunningApplication),runningApplicationWithProcessIdentifier:target.pid];
            let ok: bool = msg_send![running,activateWithOptions:1usize];
            if !ok {
                return Err(PinFailure::FocusChanged);
            }
            Ok(())
        })?;
        let budget = Budget::new();
        budget.prepare(&cached.window)?;
        let action = CFString::new("AXRaise");
        check(unsafe {
            AXUIElementPerformAction(cached.window.raw(), action.as_concrete_TypeRef())
        })
    }
    pub fn fallback(
        &mut self,
        app: &AppHandle,
        manager: &Arc<PinManager>,
        record: &mut DeliveryRecord,
    ) -> WriteOutcome {
        if !manager.valid(&record.target) {
            return WriteOutcome::deferred(PinFailure::Cancelled);
        }
        let prepare = (|| {
            let mut field = self.resolve_for_mode(&record.target, false)?;
            self.open(&record.target)?;
            let baseline = field.value()?;
            record.text = write::text_for_append(&baseline, &record.text);
            app.state::<Arc<HistoryManager>>()
                .prepare_delivery_text(&record.id, &record.text)
                .map_err(|_| PinFailure::HistorySaveFailed)?;
            let end = baseline.encode_utf16().count();
            field.select_end(end)?;
            set(
                &field.element,
                "AXFocused",
                &CFBoolean::true_value().as_CFType(),
                &Budget::new(),
            )?;
            if field.selected_range()? != (end, 0) || field.value()? != baseline {
                return Err(PinFailure::FocusChanged);
            }
            let cached = self
                .cache
                .get(&record.target.id)
                .ok_or(PinFailure::NotFound)?;
            let focused = element_attr(&cached.app, "AXFocusedUIElement", &Budget::new())?;
            if !focused.equal(&field.element) {
                return Err(PinFailure::FocusChanged);
            }
            let observer = FocusObserver::new(record.target.pid, &cached.app, &field.element)?;
            Ok((field, baseline, observer))
        })();
        let (mut field, baseline, observer) = match prepare {
            Ok(v) => v,
            Err(reason) => return WriteOutcome::deferred(reason),
        };
        let history = app.state::<Arc<HistoryManager>>();
        if history.checkpoint_delivery(&record.id, 0, true).is_err() {
            return WriteOutcome::deferred(PinFailure::HistorySaveFailed);
        }
        let app_for_paste = app.clone();
        let manager = manager.clone();
        let target = record.target.clone();
        let text = record.text.clone();
        let valid = observer.valid.clone();
        let (tx, rx) = mpsc::channel();
        if app
            .run_on_main_thread(move || {
                let result = if !manager.valid(&target)
                    || !valid.load(Ordering::Acquire)
                    || process(None).is_none_or(|p| p.0 != target.pid)
                {
                    Err(PinFailure::FocusChanged)
                } else {
                    let settings = crate::settings::get_settings(&app_for_paste);
                    crate::clipboard::paste_with_focus_guard(
                        text,
                        app_for_paste,
                        &settings,
                        &|| {
                            manager.valid(&target)
                                && valid.load(Ordering::Acquire)
                                && process(None).is_some_and(|p| p.0 == target.pid)
                        },
                    )
                    .map_err(|error| {
                        if error == crate::clipboard::PASTE_TARGET_CHANGED {
                            PinFailure::FocusChanged
                        } else {
                            PinFailure::VerifyFailed
                        }
                    })
                };
                let _ = tx.send(result);
            })
            .is_err()
        {
            return WriteOutcome::deferred(PinFailure::FocusChanged);
        }
        let deadline = Instant::now() + Duration::from_secs(3);
        let pasted = loop {
            observer.poll();
            match rx.try_recv() {
                Ok(result) => break Some(result),
                Err(mpsc::TryRecvError::Disconnected) => break None,
                Err(mpsc::TryRecvError::Empty) => {
                    if Instant::now() >= deadline {
                        observer.valid.store(false, Ordering::Release);
                        break None;
                    }
                }
            }
        };
        // Keep the observer alive until the callback has completed; on timeout
        // its shared flag prevents any later queued callback from pasting.
        observer.valid.store(false, Ordering::Release);
        match pasted {
            Some(Err(PinFailure::FocusChanged)) => WriteOutcome::deferred(PinFailure::FocusChanged),
            Some(Ok(())) => {
                field.verify_after_write = true;
                if field
                    .value()
                    .is_ok_and(|value| value == format!("{baseline}{}", record.text))
                {
                    WriteOutcome {
                        state: DeliveryState::Delivered,
                        reason: None,
                        confirmed_utf16: record.text.encode_utf16().count(),
                        may_have_written: true,
                    }
                } else {
                    WriteOutcome {
                        state: DeliveryState::Uncertain,
                        reason: Some(PinFailure::VerifyFailed),
                        confirmed_utf16: 0,
                        may_have_written: true,
                    }
                }
            }
            _ => WriteOutcome {
                state: DeliveryState::Uncertain,
                reason: Some(PinFailure::Interrupted),
                confirmed_utf16: 0,
                may_have_written: true,
            },
        }
    }
}

pub(super) struct Field {
    element: Element,
    window: Element,
    app: Element,
    target: PinnedTarget,
    born: f64,
    verify_after_write: bool,
}
impl Field {
    fn validate(&self, budget: &Budget) -> Result<(), PinFailure> {
        let (_, bundle, _, born) = process(Some(self.target.pid)).ok_or(PinFailure::AppGone)?;
        if born != self.born || bundle != self.target.bundle_id {
            return Err(PinFailure::AppGone);
        }
        if !element_attr(&self.element, "AXWindow", budget)?.equal(&self.window)
            || !array(&self.app, "AXWindows", 64, budget)?
                .iter()
                .any(|w| w.equal(&self.window))
        {
            return Err(PinFailure::NotFound);
        }
        let current = locator(&self.element, &self.window, budget)?;
        let expected = &self.target.locator;
        if current.role != expected.role
            || current.subrole != expected.subrole
            || current.identifier != expected.identifier
            || current.document != expected.document
            || current.label != expected.label
            || (expected.document.is_none() && current.window_title != expected.window_title)
        {
            return Err(PinFailure::NotFound);
        }
        Ok(())
    }
}
impl TextField for Field {
    fn value(&mut self) -> Result<String, PinFailure> {
        if self.verify_after_write {
            std::thread::sleep(Duration::from_millis(100));
            self.verify_after_write = false;
        }
        let budget = Budget::new();
        self.validate(&budget)?;
        let value = attr(&self.element, "AXValue", &budget)?
            .downcast_into::<CFString>()
            .ok_or(PinFailure::NotSettable)?;
        let text = value.to_string();
        if text.len() > write::MAX_FIELD_BYTES {
            return Err(PinFailure::TooLarge);
        }
        Ok(text)
    }
    fn select_end(&mut self, offset: usize) -> Result<(), PinFailure> {
        let budget = Budget::new();
        self.validate(&budget)?;
        let range = CFRange {
            location: offset.try_into().map_err(|_| PinFailure::TooLarge)?,
            length: 0,
        };
        let raw =
            unsafe { AXValueCreate(kAXValueTypeCFRange, &range as *const _ as *const c_void) };
        if raw.is_null() {
            return Err(PinFailure::NotSettable);
        }
        let value = unsafe { CFType::wrap_under_create_rule(raw as _) };
        set(&self.element, "AXSelectedTextRange", &value, &budget)
    }
    fn selected_range(&mut self) -> Result<(usize, usize), PinFailure> {
        let value = attr(&self.element, "AXSelectedTextRange", &Budget::new())?;
        if value.type_of() != unsafe { AXValueGetTypeID() } {
            return Err(PinFailure::NotSettable);
        }
        let mut range = CFRange {
            location: 0,
            length: 0,
        };
        if !unsafe {
            AXValueGetValue(
                value.as_CFTypeRef() as _,
                kAXValueTypeCFRange,
                &mut range as *mut _ as *mut c_void,
            )
        } || range.location < 0
            || range.length < 0
        {
            return Err(PinFailure::NotSettable);
        }
        Ok((range.location as usize, range.length as usize))
    }
    fn insert(&mut self, text: &str, baseline: &str) -> Result<(), PinFailure> {
        let budget = Budget::new();
        self.validate(&budget)?;
        let current = attr(&self.element, "AXValue", &budget)?
            .downcast_into::<CFString>()
            .ok_or(PinFailure::NotSettable)?;
        if current != baseline || self.selected_range()? != (baseline.encode_utf16().count(), 0) {
            return Err(PinFailure::ValueChanged);
        }
        self.verify_after_write = true;
        set(
            &self.element,
            "AXSelectedText",
            &CFString::new(text).as_CFType(),
            &budget,
        )
    }
}

// Explicit keyboard recovery alone installs an observer. Its cancellation flag
// crosses threads; its AX objects and callback context never do.
struct FocusObserver {
    observer: CFType,
    valid: Arc<AtomicBool>,
}
unsafe extern "C" fn invalidate(
    _observer: AXObserverRef,
    _element: AXUIElementRef,
    _notification: core_foundation::string::CFStringRef,
    context: *mut c_void,
) {
    if !context.is_null() {
        let valid = unsafe { &*(context as *const AtomicBool) };
        valid.store(false, Ordering::Release);
    }
}
impl FocusObserver {
    fn new(pid: i32, app: &Element, field: &Element) -> Result<Self, PinFailure> {
        let mut raw = std::ptr::null_mut();
        check(unsafe { AXObserverCreate(pid, invalidate, &mut raw) })?;
        if raw.is_null() {
            return Err(PinFailure::NotSettable);
        }
        let observer = unsafe { CFType::wrap_under_create_rule(raw as _) };
        let valid = Arc::new(AtomicBool::new(true));
        for (element, name) in [
            (app, "AXFocusedUIElementChanged"),
            (app, "AXFocusedWindowChanged"),
            (app, "AXApplicationDeactivated"),
            (field, "AXSelectedTextChanged"),
            (field, "AXValueChanged"),
        ] {
            let key = CFString::new(name);
            check(unsafe {
                AXObserverAddNotification(
                    raw,
                    element.raw(),
                    key.as_concrete_TypeRef(),
                    Arc::as_ptr(&valid) as *mut c_void,
                )
            })?;
        }
        unsafe {
            core_foundation::runloop::CFRunLoopAddSource(
                core_foundation::runloop::CFRunLoopGetCurrent(),
                AXObserverGetRunLoopSource(raw),
                core_foundation::runloop::kCFRunLoopDefaultMode,
            )
        };
        Ok(Self { observer, valid })
    }
    fn poll(&self) {
        unsafe {
            core_foundation::runloop::CFRunLoopRunInMode(
                core_foundation::runloop::kCFRunLoopDefaultMode,
                0.01,
                1,
            )
        };
    }
}
impl Drop for FocusObserver {
    fn drop(&mut self) {
        self.valid.store(false, Ordering::Release);
        unsafe {
            core_foundation::runloop::CFRunLoopRemoveSource(
                core_foundation::runloop::CFRunLoopGetCurrent(),
                AXObserverGetRunLoopSource(self.observer.as_CFTypeRef() as _),
                core_foundation::runloop::kCFRunLoopDefaultMode,
            )
        };
    }
}
