import webPush from "web-push";

const keys = webPush.generateVAPIDKeys();

console.log("Add these values to your deployment environment:\n");
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log("VAPID_SUBJECT=mailto:you@example.com");
