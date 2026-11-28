import { gettext as _, ngettext } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as MessageTray from "resource:///org/gnome/shell/ui/messageTray.js";

export class NotificationManager {
    #settings;
    #extensionName;
    #notificationSource;

    constructor(extensionName, settings) {
        this.#settings = settings;
        this.#extensionName = extensionName;
    }

    notifyArrival(prayer) {
        this.#triggerNotification(prayer.icon, _("Time for %s").format(prayer.name), _("It is time to pray."));
    }

    notifyReminder(prayer) {
        this.#triggerNotification(prayer.icon, _("%s Reminder").format(prayer.name), ngettext("Begins in %d minute.", "Begins in %d minutes.", this.#settings.reminder).format(this.#settings.reminder));
    }

    notifyError(title, body) {
        this.#triggerNotification(null, title, body, MessageTray.Urgency.HIGH);
    }

    notifyAlert(title, body, actions = [], dismissCallback = () => {}) {
        const notification = this.#triggerNotification(null, title, body, MessageTray.Urgency.HIGH);
        for (const action of actions) notification.addAction(action.title, action.callback);
        notification.connect("destroy", (_notification, reason) => {
            if (reason === MessageTray.NotificationDestroyedReason.DISMISSED) dismissCallback();
        });
    }

    #triggerNotification(gicon = null, title, body, urgency = MessageTray.Urgency.NORMAL) {
        if (!this.#settings.isNotify) return;

        if (!this.#notificationSource) {
            this.#notificationSource = new MessageTray.Source({
                title: this.#extensionName,
                iconName: "preferences-system-time-symbolic",
            });
            this.#notificationSource.connect("destroy", () => (this.#notificationSource = null));
            Main.messageTray.add(this.#notificationSource);
        }
        const notification = new MessageTray.Notification({
            source: this.#notificationSource,
            title,
            body,
            gicon,
            urgency,
            isTransient: false,
        });
        this.#notificationSource.addNotification(notification);
        return notification;
    }

    destroy() {
        if (this.#notificationSource) {
            this.#notificationSource.destroy();
            this.#notificationSource = null;
        }
    }
}
