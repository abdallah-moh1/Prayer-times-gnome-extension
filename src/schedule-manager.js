import Geoclue from "gi://Geoclue";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import { MawaqitClient } from "./providers/mawaqit-client.js";
import { PrayerTimesCalculator } from "./providers/prayer-times-calculator.js";

class TimeFetcher {
    #settings;
    #extensionName;
    #cancellable;
    #timezone = GLib.TimeZone.new_local();
    #mawaqit = null;
    #isFallbackToLocal = false;
    #location = null;

    constructor(settings, extensionName, cancellable) {
        this.#settings = settings;
        this.#extensionName = extensionName;
        this.#cancellable = cancellable;
    }

    get isCancelled() {
        return this.#cancellable.is_cancelled();
    }

    async get(dateTime) {
        if (this.isCancelled) throw new Error("Cancelled");

        const ymd = dateTime.get_ymd();

        if (this.#settings.prayerTimeSource === "mawaqit" && !this.#isFallbackToLocal) {
            try {
                this.#mawaqit ??= await MawaqitClient.create(this.#settings, this.#extensionName, this.#cancellable);
                return await this.#mawaqit.getTimes(ymd);
            } catch (e) {
                if (this.isCancelled) throw e;
                this.#isFallbackToLocal = true;
                const locationType = this.#settings.isAutoLocation ? _("automatic location detection") : _("manual location");
                Main.notify(this.#extensionName, _("Mawaqit client failed, defaulting to local calculations with %s: %s").format(locationType, e.message));
            }
        }

        if (!this.#location) {
            if (this.#settings.isAutoLocation) {
                try {
                    this.#location = await this.#getGeoclueLocation();
                } catch (e) {
                    if (this.isCancelled) throw e;
                    Main.notify(this.#extensionName, _("Failed to find location automatically. Defaulting to manual location: %s").format(e.message));
                }
            }
            this.#location ??= { latitude: this.#settings.latitude, longitude: this.#settings.longitude };
        }
        return new PrayerTimesCalculator(
            ymd,
            this.#timezone,
            this.#location,
            {
                id: this.#settings.presetMethod,
                fajr: this.#settings.fajrAngle,
                isha: this.#settings.ishaAngle,
            },
            this.#settings.asrMethod,
            this.#settings.highLatAdjustment,
        );
    }
    #getGeoclueLocation() {
        return new Promise((resolve, reject) => {
            Geoclue.Simple.new_with_thresholds(this.#extensionName, Geoclue.AccuracyLevel.NEIGHBORHOOD, 600, 5000, this.#cancellable, (_source, result) => {
                let proxy = null;
                try {
                    proxy = Geoclue.Simple.new_with_thresholds_finish(result);
                    const location = proxy?.get_location();
                    if (!location) throw new Error(_("Automatic location is unavailable."));
                    resolve({ latitude: location.latitude, longitude: location.longitude });
                } catch (e) {
                    reject(e);
                } finally {
                    proxy?.get_client()?.call_stop(null, null);
                }
            });
        });
    }
}

export class ScheduleManager {
    #settings;
    #metadata;
    #schedule = { prayers: [], nextPrayerIndex: 0 };
    #cancellable = null;

    constructor(settings, metadata) {
        this.#settings = settings;
        this.#metadata = metadata;
    }

    get schedule() {
        return this.#schedule;
    }
    get nextPrayer() {
        return this.#schedule.prayers[this.#schedule.nextPrayerIndex];
    }
    get nextPrayerIndex() {
        return this.#schedule.nextPrayerIndex;
    }

    async buildSchedule() {
        const fetcher = this.#createFetcher();
        try {
            const now = GLib.DateTime.new_now_local();
            const todayTimes = await fetcher.get(now);

            let prayers, nextPrayerIndex;

            if (now.compare(todayTimes.fajr) < 0) {
                const yesterdayTimes = await fetcher.get(now.add_days(-1));
                // edge case: new day, but yesterday's isha hasn't passed
                if (now.compare(yesterdayTimes.isha) < 0) {
                    prayers = this.#buildPrayerList(yesterdayTimes);
                    nextPrayerIndex = prayers.length - 1;
                } else {
                    prayers = this.#buildPrayerList(todayTimes);
                    nextPrayerIndex = 0;
                }
            } else if (now.compare(todayTimes.isha) >= 0) {
                const tomorrowTimes = await fetcher.get(now.add_days(1));
                prayers = this.#buildPrayerList(tomorrowTimes);
                nextPrayerIndex = 0;
            } else {
                prayers = this.#buildPrayerList(todayTimes);
                nextPrayerIndex = prayers.findIndex((p) => p.time.compare(now) > 0);
            }

            if (fetcher.isCancelled) return false;
            this.#schedule = { prayers, nextPrayerIndex };
            return true;
        } catch (e) {
            if (!fetcher.isCancelled) console.error(`[${this.#metadata.name}]: Failed to build schedule:`, e);
        }
        return false;
    }

    async advanceToNextPrayer() {
        if (this.#schedule.nextPrayerIndex < this.#schedule.prayers.length - 1) {
            this.#schedule.nextPrayerIndex++;
            return false;
        }

        const fetcher = this.#createFetcher();
        try {
            const tomorrowTimes = await fetcher.get(this.#schedule.prayers[0].time.add_days(1));
            if (fetcher.isCancelled) return false;
            this.#schedule = { prayers: this.#buildPrayerList(tomorrowTimes), nextPrayerIndex: 0 };
            return true;
        } catch (e) {
            if (!fetcher.isCancelled) console.error(`[${this.#metadata.name}]: Failed to advance to new day:`, e);
        }
        return false;
    }

    #createFetcher() {
        this.#cancellable?.cancel();
        this.#cancellable = new Gio.Cancellable();
        return new TimeFetcher(this.#settings, this.#metadata.name, this.#cancellable);
    }

    #buildPrayerList(prayerTimes) {
        const prayer = (id, name) => ({ id, name, time: prayerTimes[id] ?? null, icon: this.#createIcon(id) });

        const fajr = prayer("fajr", _("Fajr"));
        const dhuhr = prayer("dhuhr", prayerTimes.dhuhr.get_day_of_week() === 5 ? _("Jumaah") : _("Dhuhr"));
        const asr = prayer("asr", _("Asr"));
        const maghrib = prayer("maghrib", _("Maghrib"));
        const isha = prayer("isha", _("Isha"));

        return this.#settings.isIncludeSunnah && prayerTimes.duha //
            ? [fajr, prayer("duha", _("Duha")), dhuhr, asr, maghrib, isha]
            : [fajr, dhuhr, asr, maghrib, isha];
    }

    #createIcon(id) {
        const iconSuffix = this.#settings.useSymbolicIcons ? "-symbolic.svg" : ".svg";
        return Gio.icon_new_for_string(this.#metadata.path + "/assets/icons/" + id + iconSuffix);
    }

    destroy() {
        if (this.#cancellable) {
            this.#cancellable.cancel();
            this.#cancellable = null;
        }
    }
}
