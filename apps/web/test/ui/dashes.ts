/** Em and en dashes, and box-drawing characters used as comment banners. */
export const DASHES = new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + String.fromCharCode(0x2500) + '-' + String.fromCharCode(0x257f) + ']');
