import Gio from "gi://Gio";
import GLib from "gi://GLib";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { Extension, gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import { Settings } from "./utils/settings.js";
import { Menu, Indicator } from "./ui.js";
import { NotificationManager } from "./utils/notification-manager.js";
import { ScheduleManager } from "./services/schedule-manager.js";

export default class PrayerTime extends Extension {
    enable() {
        this._soundFile = null;
        this._timeoutId = null;
        this._startTimer = null;

        this._settings = new Settings(this.getSettings(), this.metadata);

        this._scheduleManager = new ScheduleManager(this._settings, this.metadata, () => this.reInit());

        this._indicator = new Indicator(this.metadata.name, this._settings);
        this._menu = new Menu(this._indicator, this._settings);
        this._indicator.setMenu(this._menu);
        Main.panel.addToStatusArea(this.uuid, this._indicator, this._settings.indicatorOrder, this._settings.indicatorAlignment);
        this._notifier = new NotificationManager(this.metadata.name, this._settings);

        this._init();

        this._settingSignals = [
            this._settings.connect("changed::display-mode", () => this.reInit()),
            this._settings.connect("changed::use-symbolic-icons", () => this.reInit()),
            this._settings.connect("changed::reminder", () => this.reInit()),
            this._settings.connect("changed::indicator-alignment", () => {
                const container = this._indicator.container;
                container.get_parent().remove_child(container);
                Main.panel[`_${this._settings.indicatorAlignment}Box`]?.insert_child_at_index(container, this._settings.indicatorOrder);
            }),
            this._settings.connect("changed::indicator-order", () => {
                const container = this._indicator.container;
                container.get_parent().set_child_at_index(container, this._settings.indicatorOrder);
            }),
        ];

        // update extension on system wake
        this._wakeSignalId = Gio.DBus.system.signal_subscribe("org.freedesktop.login1", "org.freedesktop.login1.Manager", "PrepareForSleep", "/org/freedesktop/login1", null, Gio.DBusSignalFlags.NONE, (_connection, _sender, _path, _interface, _signal, params) => {
            if (!params.get_child_value(0).get_boolean()) this.reInit();
        });
    }

    async _init() {
        try {
            const ready = await this._scheduleManager.buildSchedule();
            if (!ready) return;

            this._menu.populate(this._scheduleManager.schedule);

            this._soundFile = Gio.File.new_for_path(this.path + "/assets/audio/athan.ogg"); // TODO: don't include if sound disabled

            this._startTimer = this._settings.displayMode === "countdown" ? this._startCountdown : this._startStaticWait;
            this._scheduleNextEvent();
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) return;
            console.error(`[${this.metadata.name}]: Init error:`, e);
        }
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

    _startCountdown(targetTimeUsec, onComplete) {
        const tick = () => {
            const uSecLeft = targetTimeUsec - GLib.get_real_time();

            // 3 sec buffer
            if (uSecLeft <= 3e6) {
                onComplete();
                return;
            }

            this._indicator.setCountdown(uSecLeft);
            // TODO: optimise and use timeout directly
            this._scheduleTimeout(60, tick);
        };

        tick();
    }
    _startStaticWait(targetTimeUsec, onComplete) {
        this._indicator.setTime(this._scheduleManager.nextPrayer.time);
        this._scheduleTimeout(Math.ceil((targetTimeUsec - GLib.get_real_time()) / 1e6), () => onComplete());
    }

    _scheduleNextEvent() {
        const nextPrayer = this._scheduleManager.nextPrayer;

        this._indicator.setPrayer(this._scheduleManager.nextPrayer);

        const nextPrayerUsec = nextPrayer.time.to_unix_usec();
        if (this._settings.reminder > 0) {
            const reminderTargetUsec = nextPrayerUsec - this._settings.reminder * 6e7;
            if (reminderTargetUsec > GLib.get_real_time()) {
                this._startTimer(reminderTargetUsec, () => this._onReminder());
                return;
            }
        }
        this._startTimer(nextPrayerUsec, () => this._onPrayerTime());
    }

    _onReminder() {
        this._indicator.setReminder(this._settings.reminder);
        this._notifier.notifyReminder(this._scheduleManager.nextPrayer);

        this._scheduleTimeout(60, () => this._scheduleNextEvent());
    }
    async _onPrayerTime() {
        this._indicator.setArrival();
        this._notifier.notifyArrival(this._scheduleManager.nextPrayer);
        if (this._settings.isSound) {
            global.display.get_sound_player().play_from_file(this._soundFile, _("Call to prayer"), null);
        }

        let movedToNextDay;
        try {
            movedToNextDay = await this._scheduleManager.advanceToNextPrayer();
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) return;
            console.error(`[${this.metadata.name}]: Failed to advance prayer schedule:`, e);
            // TODO: retry
            return;
        }

        if (movedToNextDay) {
            this._menu.update(this._scheduleManager.schedule);
        } else {
            this._menu.setActivePrayer(this._scheduleManager.nextPrayerIndex);
        }
        this._indicator.setPrayer(this._scheduleManager.nextPrayer);

        this._scheduleTimeout(60, () => this._scheduleNextEvent());
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
            if (this._settingSignals) {
                this._settingSignals.forEach((id) => id && this._settings.disconnect(id));
                this._settingSignals = null;
            }
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
