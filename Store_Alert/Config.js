// Store_Alert/Config (Secret).js
const config = {
    db: {
        host: process.env.MYSQL_HOST || "crossover.proxy.rlwy.net",
        port: process.env.MYSQL_PORT || 23151,
        database: process.env.MYSQL_DATABASE || "railway",
        user: process.env.MYSQL_USER || "root",
        password: process.env.MYSQL_PASSWORD || "DwPLKjZIkHdyGcjLmnsmQIwWvDjisbBm"
    },
    mqtt: {
        url: process.env.MQTT_URL || "mqtts://n0740bf0.ala.us-east-1.emqxsl.com:8883",
        ca: null,
        username: process.env.MQTT_USER || "smartbee_user",
        password: process.env.MQTT_PASS || "smartbee123",
        topic: "SmartBee/nodes/+/data"
    },
    nodo_id: "NODO-7881883A-97A5-47E0-869C-753E99E1B168",
    debug: true
};

export default config;