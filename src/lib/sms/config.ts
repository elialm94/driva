/**
 * SMS-avsändare för 46elks. V1: fast "Driva".
 * Byt här (inte i anropen) när avsändaren ska bli företagets namn.
 */
export const SMS_FROM = "Driva";

export const SMS_PROVIDER = "46elks" as const;

export const SMS_API_URL = "https://api.46elks.com/a1/sms";

export const SMS_INVALID_PHONE = "Kontrollera kundens telefonnummer.";
export const SMS_NOT_CONFIGURED = "SMS-tjänsten är inte konfigurerad i den här miljön.";
export const SMS_SEND_FAILED = "SMS kunde inte skickas.";
