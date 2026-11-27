import Gio from "gi://Gio";
import GLib from "gi://GLib";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { Extension, gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import { Settings } from "./utils/settings.js";
import { Menu, Indicator } from "./ui.js";
import { NotificationManager } from "./notification-manager.js";
import { ScheduleManager } from "./schedule-manager.js";

export default class PrayerTime extends Extension {
    enable() {
        this._soundFile = null;
        this._timeoutId = null;

        this._notifier = new NotificationManager(this.metadata.name, this._settings);
        this._settings = new Settings(this.getSettings(), this.metadata, this._notifier);
        this._scheduleManager = new ScheduleManager(this._settings, this.metadata, this._notifier);

        this._indicator = new Indicator(this.metadata.name, this._settings);
        this._menu = new Menu(this._indicator, this._settings);
        this._indicator.setMenu(this._menu);
        Main.panel.addToStatusArea(this.uuid, this._indicator, this._settings.indicatorOrder, this._settings.indicatorAlignment);

        this._init();

        this._settings.connectGSettingSignal("changed", (_settings, key) => {
            switch (key) {
                case "version-cache":
                case "notify-prayer":
                case "sound-player":
                    return;
                case "indicator-style":
                    this._indicator.updateStyle();
                    return;
                case "indicator-alignment": {
                    const container = this._indicator.container;
                    container.get_parent().remove_child(container);
                    Main.panel[`_${this._settings.indicatorAlignment}Box`]?.insert_child_at_index(container, this._settings.indicatorOrder);
                    return;
                }
                case "indicator-order": {
                    const container = this._indicator.container;
                    container.get_parent().set_child_at_index(container, this._settings.indicatorOrder);
                    return;
                }
                default:
                    this.reInit();
            }
        });
        this._settings.connectDesktopSignal("changed::clock-format", () => this.reInit());
        // update extension on system wake
        this._wakeSignalId = Gio.DBus.system.signal_subscribe("org.freedesktop.login1", "org.freedesktop.login1.Manager", "PrepareForSleep", "/org/freedesktop/login1", null, Gio.DBusSignalFlags.NONE, (_connection, _sender, _path, _interface, _signal, params) => {
            if (!params.get_child_value(0).get_boolean()) this.reInit();
        });
    }

    async _init() {
        if (!(await this._scheduleManager.buildSchedule())) return;

        this._menu.populate(this._scheduleManager.schedule);
        this._scheduleNextEvent();
    }

    _stopTimer() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
    }

    _scheduleTimeout(seconds, callback) {
        this._stopTimer();
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
            this._timeoutId = null;
            callback();
            return GLib.SOURCE_REMOVE;
        });
    }

    _scheduleNextEvent() {
        const nextPrayer = this._scheduleManager.nextPrayer;
        this._indicator.setPrayer(nextPrayer);

        const nowSec = Math.round(GLib.get_real_time() / 1e6);
        const prayerSec = nextPrayer.time.to_unix();
        const reminderMins = this._settings.reminder;

        const reminderTimeSec = prayerSec - reminderMins * 60;
        const isReminder = reminderMins > 0 && reminderTimeSec > nowSec;
        const targetSec = isReminder ? reminderTimeSec : prayerSec;

        const onComplete = async () => {
            if (isReminder) this._onReminder(nextPrayer);
            else await this._onPrayerTime(nextPrayer);

            this._scheduleTimeout(60, () => this._scheduleNextEvent());
        };

        if (this._settings.displayMode === "countdown") {
            this._startCountdownTimer(targetSec, prayerSec, onComplete);
        } else {
            this._indicator.setTime(nextPrayer.time);
            this._scheduleTimeout(Math.max(1, targetSec - nowSec), onComplete);
        }
    }
    _startCountdownTimer(targetSec, prayerSec, onComplete) {
        const tick = () => {
            const nowSec = Math.round(GLib.get_real_time() / 1e6);
            const secLeft = targetSec - nowSec;

            if (secLeft <= 0) {
                onComplete();
                return;
            }

            this._indicator.setCountdown(Math.ceil((prayerSec - nowSec) / 60));
            this._scheduleTimeout(secLeft % 60 || 60, tick);
        };
        tick();
    }

    _onReminder(prayer) {
        this._indicator.setReminder(this._settings.reminder);
        this._notifier.notifyReminder(prayer);
    }
    async _onPrayerTime(prayer) {
        this._indicator.setArrival();
        this._notifier.notifyArrival(prayer);

        if (this._settings.isSound) {
            this._soundFile ??= Gio.File.new_for_path(this.path + "/assets/audio/athan.ogg");
            global.display.get_sound_player().play_from_file(this._soundFile, _("Call to prayer"), null);
        }

        // FIXME: handle failure creeping into else
        if (await this._scheduleManager.advanceToNextPrayer()) this._menu.update(this._scheduleManager.schedule);
        else this._menu.setActivePrayer(this._scheduleManager.nextPrayerIndex);
    }

    reInit() {
        this._stopTimer();
        this._menu.clear();
        this._init();
    }

    disable() {
        this._stopTimer();

        if (this._wakeSignalId) {
            Gio.DBus.system.signal_unsubscribe(this._wakeSignalId);
            this._wakeSignalId = null;
        }

        if (this._settings) {
            this._settings.destroy();
            this._settings = null;
        }

        if (this._scheduleManager) {
            this._scheduleManager.destroy();
            this._scheduleManager = null;
        }

        if (this._notifier) {
            this._notifier.destroy();
            this._notifier = null;
        }
        if (this._menu) {
            this._menu.clear();
            this._menu = null;
        }
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }

        this._soundFile = null;
    }
}
