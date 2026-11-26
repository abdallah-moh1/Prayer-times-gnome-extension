import GObject from "gi://GObject";
import St from "gi://St";
import Clutter from "gi://Clutter";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import { gettext as _, ngettext } from "resource:///org/gnome/shell/extensions/extension.js";

export class Menu extends PopupMenu.PopupMenu {
    #settings;
    #currentActiveIndex = 0;

    constructor(sourceActor, settings) {
        super(sourceActor, 0.5, St.Side.TOP);
        this.#settings = settings;
    }

    populate(schedule) {
        for (const prayer of schedule.prayers) {
            const menuItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, activate: false, hover: false });

            menuItem.add_child(new St.Icon({ gicon: prayer.icon, icon_size: 20 }));
            menuItem.add_child(new St.Label({ text: prayer.name, style_class: "prayer-name" }));
            menuItem.add_child(new St.Widget({ x_expand: true }));
            menuItem.add_child(new St.Label({ text: prayer.time.format(this.#settings.timeFormat) }));

            this.addMenuItem(menuItem);
        }
        this.setActivePrayer(schedule.nextPrayerIndex);
    }

    setActivePrayer(i) {
        const rows = this.box.get_children();
        if (!rows[i]) return;

        rows[this.#currentActiveIndex]?.remove_style_class_name("prayer-next");

        rows[i].add_style_class_name("prayer-next");
        this.#currentActiveIndex = i;
    }

    update(schedule) {
        if (rows.length !== schedule.prayers.length) {
            this.clear();
            this.populate(schedule);
            return;
        }

        const rows = this.box.get_children();
        for (let i = 0; i < schedule.prayers.length; i++) {
            const [, icon, nameLabel, , timeLabel] = rows[i].get_children();
            const prayer = schedule.prayers[i];

            if (!icon.gicon.equal(prayer.icon)) icon.gicon = prayer.icon;
            if (nameLabel.text !== prayer.name) nameLabel.set_text(prayer.name);
            const formattedTime = prayer.time.format(this.#settings.timeFormat);
            if (timeLabel.text !== formattedTime) timeLabel.set_text(formattedTime);
        }
        this.setActivePrayer(schedule.nextPrayerIndex);
    }

    clear() {
        this.removeAll();
        this.#currentActiveIndex = null;
    }
}

class IndicatorClass extends PanelMenu.Button {
    _init(extensionName, settings) {
        super._init(0.5, extensionName, true);
        this._settings = settings;

        this._box = new St.BoxLayout({
            style: "padding: 0px 12px; spacing: 0.27em;",
        });

        this._icon = new St.Icon({
            icon_size: 16,
        });
        this._box.add_child(this._icon);
        this._nameLabel = new St.Label({
            text: "...",
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._box.add_child(this._nameLabel);
        this._detailLabel = new St.Label({
            text: "...",
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._box.add_child(this._detailLabel);

        this.add_child(this._box);
        this.updateStyle();
    }

    updateStyle() {
        const style = this._settings.indicatorStyle;
        this._icon.visible = style !== "name";
        this._nameLabel.visible = style !== "icon";
    }

    setPrayer(prayer) {
        this._icon.gicon = prayer.icon;
        this._nameLabel.text = prayer.name;
    }

    setCountdown(minsLeft) {
        const minutes = minsLeft % 60;
        this._detailLabel.text = `${(minsLeft / 60) | 0}h ${minutes < 10 ? "0" + minutes : minutes}m`;
    }
    setTime(prayerTime) {
        this._detailLabel.text = prayerTime.format(this._settings.timeFormat);
    }
    setReminder(reminderMins) {
        this._detailLabel.text = ngettext("in %d minute", "in %d minutes", reminderMins).format(reminderMins);
    }
    setArrival() {
        this._detailLabel.text = _("time");
    }
}
export const Indicator = GObject.registerClass(IndicatorClass);
