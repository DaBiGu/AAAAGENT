import {access,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const code=fileURLToPath(new URL('..',import.meta.url));
const exists=async path=>{try{await access(resolve(code,path));return true;}catch{return false;}};
const checks={node:process.version,platform:process.platform,architecture:process.arch,
  backendBuilt:await exists('dist/app/trial-backend.js'),
  cubismCore:await exists('desktop/vendor/cubism/Core/live2dcubismcore.min.js'),
  cubismFramework:await exists('desktop/vendor/cubism/Framework/src/live2dcubismframework.ts'),
  localModel:await exists('desktop/assets/local-model/pet.model3.json'),
  localPresets:await exists('desktop/assets/local-model/presets.json'),
  videoCatalog:await exists('desktop/assets/local-model/dsh-pet/catalog.json'),
  rendererBuilt:await exists('desktop/build/renderer.js'),
  nativeBuilt:await exists('desktop/build/星月陪伴.app/Contents/MacOS/DesktopPet')};
console.log(JSON.stringify({checks,scope:'Local file checks only. No credentials read, servers started, models called, or devices opened.',next:'Video mode requires separately supplied dsh-pet media and catalog.json. Live2D additionally requires your licensed SDK and rig. Both modes need local configuration and a native Mac build.'},null,2));
if(!checks.backendBuilt)process.exitCode=1;
