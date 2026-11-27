import Gio from "gi://Gio";
import * as MessageTray from "resource:///org/gnome/shell/ui/messageTray.js";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

export class Settings {
    #gSettings = null;
    #desktopSettings = null;
    #gSettingsSignal = null;
    #desktopSignal = null;

    static {
        const settingsSchema = [
            { prop: "prayerTimeSource", key: "prayer-time-source", type: "s" },
            { prop: "isAutoLocation", key: "auto-location", type: "b" },
            { prop: "latitude", key: "latitude", type: "d" },
            { prop: "longitude", key: "longitude", type: "d" },
            { prop: "presetMethod", key: "preset-methods", type: "s" },
            { prop: "fajrAngle", key: "fajr-angle", type: "d" },
            { prop: "ishaAngle", key: "isha-angle", type: "d" },
            { prop: "asrMethod", key: "asr-method", type: "s" },
            { prop: "highLatAdjustment", key: "high-latitude-adjustment", type: "s" },
            { prop: "isIncludeSunnah", key: "include-sunnah", type: "b" },
            { prop: "mawaqitSlug", key: "mawaqit-slug", type: "s" },
            { prop: "displayMode", key: "display-mode", type: "s" },
            { prop: "indicatorStyle", key: "indicator-style", type: "s" },
            { prop: "indicatorAlignment", key: "indicator-alignment", type: "s" },
            { prop: "indicatorOrder", key: "indicator-order", type: "i" },
            { prop: "useSymbolicIcons", key: "use-symbolic-icons", type: "b" },
            { prop: "isNotify", key: "notify-prayer", type: "b" },
            { prop: "isSound", key: "sound-player", type: "b" },
            { prop: "reminder", key: "reminder", type: "i" },
        ];
        const getters = {
            s: "get_string",
            i: "get_int",
            d: "get_double",
            b: "get_boolean",
        };
        for (const setting of settingsSchema) {
            Object.defineProperty(this.prototype, setting.prop, {
                get() {
                    return this.#gSettings[getters[setting.type]](setting.key);
                },
                enumerable: true,
                configurable: false,
            });
        }

        Object.defineProperty(this.prototype, "timeFormat", {
            get() {
                return this.#desktopSettings.get_string("clock-format") === "12h" ? _("%-I:%M %p") : _("%R");
            },
            enumerable: true,
            configurable: false,
        });
    }

    constructor(gSettings, metadata, notifier) {
        this.#gSettings = gSettings;
        this.#desktopSettings = Gio.Settings.new("org.gnome.desktop.interface");
        const schemaVersion = gSettings.get_int("version-cache");

        // setting migration
        if (schemaVersion >= 16 && schemaVersion <= 19) {
            switch (gSettings.get_string("source")) {
                case "mawaqit":
                    gSettings.set_string("prayer-time-source", "mawaqit");
                    gSettings.set_boolean("auto-location", gSettings.get_boolean("fallback-auto-location"));
                    break;
                case "auto":
                    gSettings.set_string("prayer-time-source", "local-calculation");
                    gSettings.set_boolean("auto-location", true);
                    break;
                case "manual":
                    gSettings.set_string("prayer-time-source", "local-calculation");
                    gSettings.set_boolean("auto-location", false);
                    break;
            }
        }

        if (schemaVersion < metadata.version) {
            const updateVersionCache = () => this.#gSettings.set_int("version-cache", metadata.version);
            notifier.notifyAlert(
                _("%s Updated").format(metadata.name),
                _("Extension has been updated to v%d.").format(metadata.version),
                [
                    {
                        title: _("Review Changes"),
                        action: () => {
                            Gio.AppInfo.launch_default_for_uri(metadata.url + "/releases/tag/v" + metadata.version, null);
                            updateVersionCache();
                        },
                    },
                    {
                        title: _("Dismiss"),
                        action: () => {
                            notification.destroy();
                            updateVersionCache();
                        },
                    },
                ],
                updateVersionCache,
            );
        }
    }

    connectGSettingSignal(signal, callback) {
        this.#gSettingsSignal = this.#gSettings.connect(signal, callback);
    }

    connectDesktopSignal(signal, callback) {
        this.#desktopSignal = this.#desktopSettings.connect(signal, callback);
    }

    destroy() {
        if (this.#gSettingsSignal) {
            this.#gSettings?.disconnect(this.#gSettingsSignal);
            this.#gSettingsSignal = null;
        }
        this.#gSettings = null;
        if (this.#desktopSignal) {
            this.#desktopSettings?.disconnect(this.#desktopSignal);
            this.#desktopSignal = null;
        }
        this.#desktopSettings = null;
    }
}
