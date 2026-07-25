import { defineConfig } from '@apps-in-toss/web-framework/config'

export default defineConfig({
    appName: 'grainsplit',
    brand: {
        displayName: '결 가르기',
        primaryColor: '#c9a227',
        icon: 'https://static.toss.im/appsintoss/29597/83bbb2f9-b597-4ae5-9780-132a89d6cadd.png',
    },
    web: {
        host: '192.168.0.169',
        port: 5173,
        commands: {
            dev: 'vite --host',
            build: 'vite build',
        },
    },
    webViewProps: {
        type: 'game',
    },
    permissions: [],
})
