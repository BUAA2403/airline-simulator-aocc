export function createHash(algorithm){
 if(algorithm!=='sha256')throw new Error('Unsupported digest');
 let value='';return {update(input){value+=input;return this;},digest(format){if(format!=='hex')throw new Error('Unsupported digest format');return window.PolarisNative.sha256(value);}};
}
