import fs from 'fs';
import path from 'path';

const LOCALES_DIR = path.join(__dirname, '../src/i18n/locales');
const REFERENCE_LANG = 'en';

// All non-English locales that need fixing
const LOCALES_TO_FIX = [
  'ar', 'cs', 'de', 'es', 'fr', 'it', 'ja', 'ko', 'pl', 'pt', 'ru', 'tr', 'uk', 'vi', 'zh', 'zh-TW'
];

// Missing keys that need to be added (from EN translation.json)
const MISSING_KEYS = {
  sidebar: {
    ollama: 'LLM Models',
    corrections: 'Corrections'
  },
  settings: {
    general: {
      fileTranscription: {
        title: 'Audio File Transcription',
        description: 'Transcribe a local WAV file using your current local model.',
        pickFile: 'Choose WAV File',
        transcribing: 'Transcribing...',
        copy: 'Copy Result',
        placeholder: 'Transcription output will appear here.',
        errors: {
          failed: 'Failed to transcribe file.',
          copyFailed: 'Failed to copy transcription.'
        }
      }
    },
    history: {
      emptyJots: 'No jots yet. Enable post-processing to see completed results.',
      tabs: {
        recordings: 'Recordings',
        jots: 'Jots'
      },
      promptUsed: 'Prompt used'
    },
    corrections: {
      title: 'Auto-Corrections',
      description: 'Learn from your edits after transcription paste to automatically correct recurring mistakes.',
      tracking: {
        label: 'Correction Tracking',
        description: 'Monitor text fields after paste to learn from your corrections.'
      },
      autoApply: {
        label: 'Auto-Apply Corrections',
        description: 'Automatically apply learned corrections to future transcriptions.'
      },
      promptBias: {
        label: 'Prompt Bias',
        description: 'Include learned corrections as hints in the post-processing prompt.'
      },
      thresholds: {
        title: 'Thresholds'
      },
      monitoringDelay: {
        label: 'Monitoring Delay',
        description: 'How long to watch the text field for corrections after paste (seconds).'
      },
      minFrequency: {
        label: 'Min Frequency',
        description: 'Minimum number of times a correction must occur before it is applied.'
      },
      minConfidence: {
        label: 'Min Confidence',
        description: 'Minimum confidence score required for a correction to be applied.'
      },
      dictionary: {
        title: 'Learned Corrections',
        empty: 'No learned corrections yet. Start dictating and editing to build your correction dictionary.',
        count: '{{count}} learned correction(s)',
        import: 'Import',
        export: 'Export',
        clearAll: 'Clear All',
        columns: {
          original: 'Original',
          corrected: 'Corrected',
          frequency: 'Freq',
          confidence: 'Conf',
          source: 'Source App',
          active: 'Active'
        }
      }
    }
  }
};

function deepMerge(target: any, source: any): any {
  const result = { ...target };
  
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  
  return result;
}

function fixLocale(locale: string) {
  const localePath = path.join(LOCALES_DIR, locale, 'translation.json');
  console.log(`\nFixing ${locale}...`);
  
  // Read current translations
  const currentContent = fs.readFileSync(localePath, 'utf-8');
  const currentTranslations = JSON.parse(currentContent);
  
  // Merge missing keys
  const fixed = deepMerge(currentTranslations, MISSING_KEYS);
  
  // Write back with proper formatting
  fs.writeFileSync(localePath, JSON.stringify(fixed, null, 2) + '\n', 'utf-8');
  console.log(`✓ Fixed ${locale}`);
}

console.log('🌍 Fixing translation files...');
console.log(`Adding missing keys to ${LOCALES_TO_FIX.length} locales\n`);

LOCALES_TO_FIX.forEach(fixLocale);

console.log('\n✅ All translations fixed!');
console.log('\nNext steps:');
console.log('1. Run: bun run format:write');
console.log('2. Commit the changes');
