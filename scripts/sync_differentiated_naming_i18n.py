#!/usr/bin/env python3
"""Sync differentiated naming blocks from en/translation.json into all locales."""
from __future__ import annotations

import copy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCALES = ROOT / "src" / "i18n" / "locales"
EN_PATH = LOCALES / "en" / "translation.json"

# Sidebar + experimental titles: localized short labels.
LOCALE_SIDEBAR_TRAY = {
    "de": {
        "dataPrivacy": "Datenschutz & Daten",
        "experimental": "Labor",
        "snippets": "Phrase-Tasten",
        "styles": "Schreibprofile",
        "experimental_title": "Labor",
        "advanced_group_experimental": "Labor",
        "experimental_toggle_label": "Labor-Funktionen",
        "experimental_toggle_desc": "In-Entwicklung-Optionen aktivieren. Mit Vorsicht nutzen.",
    },
    "fr": {
        "dataPrivacy": "Confidentialité et données",
        "experimental": "Labo",
        "snippets": "Clés de phrase",
        "styles": "Profils d'écriture",
        "experimental_title": "Labo",
        "advanced_group_experimental": "Labo",
        "experimental_toggle_label": "Fonctions labo",
        "experimental_toggle_desc": "Activer les options en cours de développement. À utiliser avec prudence.",
    },
    "es": {
        "dataPrivacy": "Privacidad y datos",
        "experimental": "Laboratorio",
        "snippets": "Claves de frase",
        "styles": "Perfiles de escritura",
        "experimental_title": "Laboratorio",
        "advanced_group_experimental": "Laboratorio",
        "experimental_toggle_label": "Funciones de laboratorio",
        "experimental_toggle_desc": "Activa opciones en desarrollo. Úsalas con cuidado.",
    },
    "it": {
        "dataPrivacy": "Privacy e dati",
        "experimental": "Laboratorio",
        "snippets": "Chiavi di frase",
        "styles": "Profili di scrittura",
        "experimental_title": "Laboratorio",
        "advanced_group_experimental": "Laboratorio",
        "experimental_toggle_label": "Funzioni laboratorio",
        "experimental_toggle_desc": "Attiva opzioni in sviluppo. Usa con cautela.",
    },
    "pt": {
        "dataPrivacy": "Privacidade e dados",
        "experimental": "Laboratório",
        "snippets": "Chaves de frase",
        "styles": "Perfis de escrita",
        "experimental_title": "Laboratório",
        "advanced_group_experimental": "Laboratório",
        "experimental_toggle_label": "Recursos de laboratório",
        "experimental_toggle_desc": "Ative opções em desenvolvimento. Use com cuidado.",
    },
    "vi": {
        "dataPrivacy": "Quyền riêng tư & dữ liệu",
        "experimental": "Phòng thử",
        "snippets": "Khóa cụm từ",
        "styles": "Hồ sơ viết",
        "experimental_title": "Phòng thử",
        "advanced_group_experimental": "Phòng thử",
        "experimental_toggle_label": "Tính năng phòng thử",
        "experimental_toggle_desc": "Bật các tùy chọn đang phát triển. Dùng cẩn thận.",
    },
    "zh": {
        "dataPrivacy": "隐私与数据",
        "experimental": "实验室",
        "snippets": "短语快捷键",
        "styles": "写作配置",
        "experimental_title": "实验室",
        "advanced_group_experimental": "实验室",
        "experimental_toggle_label": "实验室功能",
        "experimental_toggle_desc": "开启开发中的选项，请谨慎使用。",
    },
    "zh-TW": {
        "dataPrivacy": "隱私與資料",
        "experimental": "實驗室",
        "snippets": "片語快速鍵",
        "styles": "寫作設定",
        "experimental_title": "實驗室",
        "advanced_group_experimental": "實驗室",
        "experimental_toggle_label": "實驗室功能",
        "experimental_toggle_desc": "開啟開發中的選項，請謹慎使用。",
    },
    "ja": {
        "dataPrivacy": "プライバシーとデータ",
        "experimental": "ラボ",
        "snippets": "フレーズキー",
        "styles": "ライトプロファイル",
        "experimental_title": "ラボ",
        "advanced_group_experimental": "ラボ",
        "experimental_toggle_label": "ラボ機能",
        "experimental_toggle_desc": "開発中のオプションを有効にします。注意してご利用ください。",
    },
    "ko": {
        "dataPrivacy": "개인정보 및 데이터",
        "experimental": "실험실",
        "snippets": "문구 키",
        "styles": "작성 프로필",
        "experimental_title": "실험실",
        "advanced_group_experimental": "실험실",
        "experimental_toggle_label": "실험실 기능",
        "experimental_toggle_desc": "개발 중인 옵션을 켭니다. 신중하게 사용하세요.",
    },
    "pl": {
        "dataPrivacy": "Prywatność i dane",
        "experimental": "Laboratorium",
        "snippets": "Klucze fraz",
        "styles": "Profile pisania",
        "experimental_title": "Laboratorium",
        "advanced_group_experimental": "Laboratorium",
        "experimental_toggle_label": "Funkcje laboratoryjne",
        "experimental_toggle_desc": "Włącz opcje w rozwoju. Używaj ostrożnie.",
    },
    "ru": {
        "dataPrivacy": "Конфиденциальность и данные",
        "experimental": "Лаборатория",
        "snippets": "Ключи фраз",
        "styles": "Профили письма",
        "experimental_title": "Лаборатория",
        "advanced_group_experimental": "Лаборатория",
        "experimental_toggle_label": "Лабораторные функции",
        "experimental_toggle_desc": "Включить опции в разработке. Используйте с осторожностью.",
    },
    "uk": {
        "dataPrivacy": "Конфіденційність і дані",
        "experimental": "Лабораторія",
        "snippets": "Ключі фраз",
        "styles": "Профілі письма",
        "experimental_title": "Лабораторія",
        "advanced_group_experimental": "Лабораторія",
        "experimental_toggle_label": "Лабораторні функції",
        "experimental_toggle_desc": "Увімкнути опції в розробці. Використовуйте обережно.",
    },
    "tr": {
        "dataPrivacy": "Gizlilik ve veriler",
        "experimental": "Laboratuvar",
        "snippets": "İfade anahtarları",
        "styles": "Yazım profilleri",
        "experimental_title": "Laboratuvar",
        "advanced_group_experimental": "Laboratuvar",
        "experimental_toggle_label": "Laboratuvar özellikleri",
        "experimental_toggle_desc": "Geliştirme aşamasındaki seçenekleri açın. Dikkatli kullanın.",
    },
    "cs": {
        "dataPrivacy": "Soukromí a data",
        "experimental": "Laboratoř",
        "snippets": "Klíče frází",
        "styles": "Profily psaní",
        "experimental_title": "Laboratoř",
        "advanced_group_experimental": "Laboratoř",
        "experimental_toggle_label": "Laboratorní funkce",
        "experimental_toggle_desc": "Zapnout rozpracované možnosti. Používejte opatrně.",
    },
    "ar": {
        "dataPrivacy": "الخصوصية والبيانات",
        "experimental": "المختبر",
        "snippets": "مفاتيح العبارات",
        "styles": "ملفات الكتابة",
        "experimental_title": "المختبر",
        "advanced_group_experimental": "المختبر",
        "experimental_toggle_label": "ميزات المختبر",
        "experimental_toggle_desc": "تفعيل الخيارات قيد التطوير. استخدم بحذر.",
    },
}


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def save_json(path: Path, data: dict) -> None:
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    en = load_json(EN_PATH)
    snippets_block = copy.deepcopy(en["settings"]["snippets"])
    styles_block = copy.deepcopy(en["settings"]["styles"])

    for locale_dir in sorted(LOCALES.iterdir()):
        if not locale_dir.is_dir():
            continue
        code = locale_dir.name
        path = locale_dir / "translation.json"
        if not path.exists() or code == "en":
            continue

        data = load_json(path)
        tray = data.setdefault("tray", {})
        sidebar = data.setdefault("sidebar", {})

        if code in LOCALE_SIDEBAR_TRAY:
            loc = LOCALE_SIDEBAR_TRAY[code]
            sidebar["dataPrivacy"] = loc["dataPrivacy"]
            sidebar["experimental"] = loc["experimental"]
            sidebar["snippets"] = loc["snippets"]
            sidebar["styles"] = loc["styles"]
            data.setdefault("settings", {}).setdefault("experimental", {})[
                "title"
            ] = loc["experimental_title"]
            adv = data.setdefault("settings", {}).setdefault("advanced", {})
            adv.setdefault("groups", {})["experimental"] = loc[
                "advanced_group_experimental"
            ]
            adv.setdefault("experimentalToggle", {})["label"] = loc[
                "experimental_toggle_label"
            ]
            adv.setdefault("experimentalToggle", {})["description"] = loc[
                "experimental_toggle_desc"
            ]
            # Localized snippets/styles blocks (translated labels for major locales)
            if code == "de":
                data["settings"]["snippets"] = {
                    "toggle": {
                        "title": "Phrase-Tasten",
                        "label": "Phrase-Tasten aktivieren",
                        "description": "Kurze gesprochene Auslöser während der Diktat in vollen Text expandieren. Sage den Auslöser und Vox Jot fügt den gespeicherten Text ein.",
                    },
                    "list": {
                        "title": "Deine Phrase-Tasten",
                        "empty": "Noch keine Phrase-Tasten. Füge einen Auslöser und den Zieltext hinzu.",
                        "add": "Phrase-Taste hinzufügen",
                        "import": "Importieren",
                        "export": "Exportieren",
                        "clearAll": "Alle löschen",
                        "trigger": "Gesprochener Auslöser",
                        "expansion": "Wird zu",
                        "triggerPlaceholder": "Was du sagst (z. B. meine E-Mail)",
                        "expansionPlaceholder": "Was eingefügt wird (z. B. user@example.com)",
                    },
                }
                data["settings"]["styles"] = {
                    "title": "Schreibprofile",
                    "description": "Schreibprofile passen die Nachbearbeitung an die aktive App an. Slack kann locker bleiben, Mail und Word professioneller.",
                    "disabledMessage": "Aktiviere Schreibprofile, um den Ton automatisch der App anzupassen, in die du diktierst.",
                    "toggle": {
                        "label": "App-bewusste Schreibprofile aktivieren",
                        "description": "Je nach Diktat-Ziel unterschiedliches Schreibprofil für Chat, E-Mail, Notizen und andere Apps anwenden.",
                    },
                    "tones": {
                        "title": "Einstiegsprofile",
                        "description": "Starte mit den eingebauten Voreinstellungen, passe die Anweisungen an und füge eigene Profile nur bei Bedarf hinzu.",
                        "helper": "Die Standardprofile decken die meisten Abläufe ab: locker für Chat, professionell für E-Mail und Dokumente, neutral für den Rest.",
                        "columns": {
                            "id": "Profil-ID",
                            "label": "Anzeigename",
                            "instruction": "Anweisung",
                        },
                        "placeholders": {
                            "id": "casual",
                            "label": "Locker",
                            "instruction": "Lockeren, gesprächigen Ton für Chatnachrichten verwenden.",
                        },
                        "add": "Eigenes Profil hinzufügen",
                        "restore": "Einstiegsprofile wiederherstellen",
                        "starterBadge": "Standard",
                        "customBadge": "Eigen",
                        "unused": "Noch keine Apps zugeordnet",
                        "editId": "Profil-ID bearbeiten",
                    },
                    "mappings": {
                        "title": "App-Zuordnungen",
                        "description": "Apps einem Profil zuweisen. Bundle-IDs sind am zuverlässigsten.",
                        "columns": {
                            "appName": "App",
                            "bundleId": "Bundle-ID",
                            "tone": "Profil",
                        },
                        "placeholders": {
                            "appName": "Slack",
                            "bundleId": "com.tinyspeck.slackmacgap",
                        },
                        "selectTone": "Profil wählen…",
                        "add": "App hinzufügen",
                        "empty": "Noch keine Zuordnungen. Unten eine hinzufügen, um den Ton pro App anzupassen.",
                    },
                }
            elif code == "fr":
                data["settings"]["snippets"] = {
                    "toggle": {
                        "title": "Clés de phrase",
                        "label": "Activer les clés de phrase",
                        "description": "Développez de courts déclencheurs parlés en texte complet pendant la dictée. Dites votre déclencheur et Vox Jot insère le texte enregistré.",
                    },
                    "list": {
                        "title": "Vos clés de phrase",
                        "empty": "Aucune clé de phrase. Ajoutez un déclencheur et le texte cible.",
                        "add": "Ajouter une clé de phrase",
                        "import": "Importer",
                        "export": "Exporter",
                        "clearAll": "Tout effacer",
                        "trigger": "Déclencheur oral",
                        "expansion": "S’étend en",
                        "triggerPlaceholder": "Ce que vous dites (ex. : mon e-mail)",
                        "expansionPlaceholder": "Texte inséré (ex. : user@example.com)",
                    },
                }
                data["settings"]["styles"] = {
                    "title": "Profils d'écriture",
                    "description": "Les profils d'écriture adaptent le post-traitement à l'application active. Slack peut rester décontracté, Mail et Word plus professionnels.",
                    "disabledMessage": "Activez les profils d'écriture pour adapter automatiquement le ton à l'application dans laquelle vous dictez.",
                    "toggle": {
                        "label": "Activer les profils d'écriture contextuels",
                        "description": "Appliquez un profil d'écriture différent pour le chat, le courriel, les notes et d'autres apps selon le contexte.",
                    },
                    "tones": {
                        "title": "Profils de départ",
                        "description": "Commencez par les préréglages intégrés, ajustez les instructions et ajoutez des profils personnalisés si besoin.",
                        "helper": "Les préréglages couvrent la plupart des usages : décontracté pour le chat, professionnel pour le courrier et les documents, neutre pour le reste.",
                        "columns": {
                            "id": "ID du profil",
                            "label": "Nom affiché",
                            "instruction": "Consigne",
                        },
                        "placeholders": {
                            "id": "casual",
                            "label": "Décontracté",
                            "instruction": "Ton décontracté et conversationnel adapté au chat.",
                        },
                        "add": "Ajouter un profil personnalisé",
                        "restore": "Restaurer les profils de départ",
                        "starterBadge": "Intégré",
                        "customBadge": "Perso",
                        "unused": "Aucune app associée",
                        "editId": "Modifier l'ID du profil",
                    },
                    "mappings": {
                        "title": "Associations d'apps",
                        "description": "Associez des apps à un profil. Les identifiants de bundle sont les plus fiables.",
                        "columns": {
                            "appName": "App",
                            "bundleId": "Bundle ID",
                            "tone": "Profil",
                        },
                        "placeholders": {
                            "appName": "Slack",
                            "bundleId": "com.tinyspeck.slackmacgap",
                        },
                        "selectTone": "Choisir un profil…",
                        "add": "Ajouter une app",
                        "empty": "Aucune association. Ajoutez-en une ci-dessous pour adapter le ton par app.",
                    },
                }
            else:
                data["settings"]["snippets"] = copy.deepcopy(snippets_block)
                data["settings"]["styles"] = copy.deepcopy(styles_block)
        else:
            sidebar["dataPrivacy"] = "Privacy & data"
            sidebar["experimental"] = "Labs"
            sidebar["snippets"] = "Phrase keys"
            sidebar["styles"] = "Write profiles"
            data.setdefault("settings", {}).setdefault("experimental", {})[
                "title"
            ] = "Labs"
            adv = data.setdefault("settings", {}).setdefault("advanced", {})
            adv.setdefault("groups", {})["experimental"] = "Labs"
            adv.setdefault("experimentalToggle", {})[
                "label"
            ] = "Labs features"
            adv.setdefault("experimentalToggle", {})[
                "description"
            ] = "Turn on in-development options. Use with care."
            data["settings"]["snippets"] = copy.deepcopy(snippets_block)
            data["settings"]["styles"] = copy.deepcopy(styles_block)

        save_json(path, data)
        print(f"updated {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
