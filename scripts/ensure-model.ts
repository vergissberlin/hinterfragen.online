import { ensureModel } from './model-cache.ts';
await ensureModel('.runtime/models');
console.log('Modell vorhanden, SHA-256 geprüft.');
