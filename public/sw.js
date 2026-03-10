// Flowy Notification Service Worker — handles background push notifications

self.addEventListener('push', (event) => {
    const data = event.data?.json() ?? {};
    const title = data.title || 'FocusFlow';
    const options = {
        body: data.body || 'You have a reminder.',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        data: { url: data.url || '/chat' },
        requireInteraction: true,
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = event.notification.data?.url || '/chat';
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            // Focus existing tab if open
            for (const client of windowClients) {
                if (client.url.includes('/chat') && 'focus' in client) {
                    return client.focus();
                }
            }
            // Otherwise open a new tab
            if (clients.openWindow) return clients.openWindow(url);
        })
    );
});
