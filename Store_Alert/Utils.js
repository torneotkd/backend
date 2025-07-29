const Utils = {
    logEnabled: false,
    logError(msg) {
        if (Utils.logEnabled) console.log(new Date(), ` - [ERROR] ${msg}`);
    },
    logInfo(msg) {
        if (Utils.logEnabled) console.log(new Date(), ` - [INFO ] ${msg}`);
    },
    async pause(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

export default Utils;
