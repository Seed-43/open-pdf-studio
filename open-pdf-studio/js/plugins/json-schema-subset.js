/**
 * Een kleine, strikte deelverzameling van JSON Schema (#575).
 *
 * Extensieopdrachten beschrijven hun invoer en uitvoer met een JSON-schema.
 * De host controleert de argumenten vóór de handler draait en het resultaat
 * erna. Daarom kent deze module alleen trefwoorden die ze ook echt
 * controleert: een schema met een ander trefwoord (oneOf, $ref,
 * patternProperties, …) wordt bij het registreren geweigerd, zodat een schema
 * nooit een controle belooft die niet gebeurt. Zie
 * docs/extensies-mcp-en-ribbon.md §16.3.
 *
 * Eén afwijking van JSON Schema, met opzet: een object-schema zonder
 * `additionalProperties` krijgt `false`. Onbekende velden worden dus
 * geweigerd, tenzij het schema `additionalProperties: true` zegt.
 *
 * Zuivere module zonder app-afhankelijkheden.
 */

const TYPEN = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
const TREFWOORDEN = new Set([
  'type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
  'minLength', 'maxLength', 'pattern', 'format',
  'minItems', 'maxItems', 'uniqueItems',
  'title', 'description', 'default', 'examples',
]);
const FORMATEN = new Set(['local-path']);
const MAX_DIEPTE = 16;
const MAX_SCHEMA = 64 * 1024;
const MAX_FOUTEN = 20;

/** Fout in een schema zelf; `pad` wijst de plek in het schema aan. */
export class SchemaFout extends Error {
  constructor(message, pad) {
    super(`${pad}: ${message}`);
    this.name = 'SchemaFout';
    this.pad = pad;
  }
}

export const isPlatObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v));

/** JSON met gesorteerde sleutels: volgorde-onafhankelijk vergelijken. */
export function canoniekeJson(v) {
  if (Array.isArray(v)) return `[${v.map(canoniekeJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort()
      .map((k) => `${JSON.stringify(k)}:${canoniekeJson(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v === undefined ? null : v);
}

/** Is dit een JSON-waarde (geen functie, NaN, Infinity, klasse-instantie of kring)? */
export function isJsonWaarde(v, gezien = new Set()) {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v !== 'object' || gezien.has(v)) return false;
  if (!Array.isArray(v) && !isPlatObject(v)) return false;
  gezien.add(v);
  const ok = (Array.isArray(v) ? v : Object.values(v)).every((k) => isJsonWaarde(k, gezien));
  gezien.delete(v);
  return ok;
}

/**
 * Een absoluut, lokaal pad: `C:\…` of `C:/…` op Windows, `/…` elders. Geen
 * netwerkshare (`\\server`, `//server`), geen apparaatpad (`\\?\`, `\\.\`),
 * geen URL, geen `..`-segment en geen stuurtekens. Dit is alleen een
 * controle van de vorm: de host geeft er geen toegang mee (§16.6).
 */
export function isLokaalPad(s) {
  if (typeof s !== 'string' || s.length < 2 || s.length > 4096) return false;
  if (/[\u0000-\u001f]/.test(s)) return false;
  if (/^[\\/]{2}/.test(s)) return false;
  const windows = /^[A-Za-z]:[\\/]/.test(s);
  const posix = s.startsWith('/');
  if (!windows && !posix) return false;
  if (s.split(/[\\/]+/).some((deel) => deel === '..')) return false;
  return true;
}

function typenVan(schema) {
  if (schema.type === undefined) return null;
  return Array.isArray(schema.type) ? schema.type : [schema.type];
}

function geheelNietNegatief(v) {
  return Number.isInteger(v) && v >= 0;
}

/**
 * Controleer en normaliseer een schema. Geeft een losgekoppelde kopie, met
 * `additionalProperties: false` op elk object-schema dat het niet noemt.
 * Gooit SchemaFout bij alles wat niet in de deelverzameling past.
 */
export function normaliseerSchema(schema, pad = '#') {
  let json;
  try {
    json = JSON.stringify(schema);
  } catch {
    throw new SchemaFout('the schema is not JSON', pad);
  }
  if (json === undefined || !isJsonWaarde(schema)) throw new SchemaFout('the schema is not JSON', pad);
  if (json.length > MAX_SCHEMA) throw new SchemaFout(`the schema is larger than ${MAX_SCHEMA / 1024} KB`, pad);
  return normaliseer(JSON.parse(json), pad, 0);
}

function normaliseer(schema, pad, diepte) {
  if (diepte > MAX_DIEPTE) throw new SchemaFout(`nested deeper than ${MAX_DIEPTE} levels`, pad);
  if (!isPlatObject(schema)) throw new SchemaFout('a schema must be an object', pad);
  for (const k of Object.keys(schema)) {
    if (!TREFWOORDEN.has(k)) throw new SchemaFout(`unsupported keyword "${k}"`, pad);
  }
  const uit = {};
  const typen = typenVan(schema);
  if (typen) {
    if (!typen.length || typen.some((t) => !TYPEN.has(t)) || new Set(typen).size !== typen.length) {
      throw new SchemaFout('type must be one or more of object, array, string, number, integer, boolean, null', pad);
    }
    uit.type = Array.isArray(schema.type) ? [...typen] : schema.type;
  } else if (schema.enum === undefined && schema.const === undefined) {
    throw new SchemaFout('a schema needs type, enum or const', pad);
  }
  const heeft = (t) => !typen || typen.includes(t) || (t === 'number' && typen.includes('integer'));

  for (const k of ['title', 'description']) {
    if (schema[k] === undefined) continue;
    const max = k === 'title' ? 200 : 2048;
    if (typeof schema[k] !== 'string' || schema[k].length > max) throw new SchemaFout(`${k} must be text of at most ${max} characters`, pad);
    uit[k] = schema[k];
  }
  if (schema.default !== undefined) uit.default = schema.default;
  if (schema.examples !== undefined) {
    if (!Array.isArray(schema.examples)) throw new SchemaFout('examples must be an array', pad);
    uit.examples = schema.examples;
  }
  if (schema.enum !== undefined) {
    if (!Array.isArray(schema.enum) || !schema.enum.length || schema.enum.length > 256) {
      throw new SchemaFout('enum must be an array of 1-256 values', pad);
    }
    uit.enum = schema.enum;
  }
  if (schema.const !== undefined) uit.const = schema.const;

  // Getallen
  for (const k of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum']) {
    if (schema[k] === undefined) continue;
    if (!heeft('number')) throw new SchemaFout(`${k} needs type number or integer`, pad);
    if (typeof schema[k] !== 'number' || !Number.isFinite(schema[k])) throw new SchemaFout(`${k} must be a number`, pad);
    uit[k] = schema[k];
  }
  if (uit.minimum !== undefined && uit.maximum !== undefined && uit.minimum > uit.maximum) {
    throw new SchemaFout('minimum is larger than maximum', pad);
  }
  // Tekst
  for (const k of ['minLength', 'maxLength']) {
    if (schema[k] === undefined) continue;
    if (!heeft('string')) throw new SchemaFout(`${k} needs type string`, pad);
    if (!geheelNietNegatief(schema[k])) throw new SchemaFout(`${k} must be a non-negative integer`, pad);
    uit[k] = schema[k];
  }
  if (uit.minLength !== undefined && uit.maxLength !== undefined && uit.minLength > uit.maxLength) {
    throw new SchemaFout('minLength is larger than maxLength', pad);
  }
  if (schema.pattern !== undefined) {
    if (!heeft('string')) throw new SchemaFout('pattern needs type string', pad);
    if (typeof schema.pattern !== 'string' || schema.pattern.length > 512) throw new SchemaFout('pattern must be text of at most 512 characters', pad);
    try {
      new RegExp(schema.pattern, 'u');
    } catch {
      throw new SchemaFout('pattern is not a valid regular expression', pad);
    }
    uit.pattern = schema.pattern;
  }
  if (schema.format !== undefined) {
    if (!heeft('string')) throw new SchemaFout('format needs type string', pad);
    if (!FORMATEN.has(schema.format)) throw new SchemaFout(`unsupported format "${schema.format}" (supported: ${[...FORMATEN].join(', ')})`, pad);
    uit.format = schema.format;
  }
  // Lijsten
  for (const k of ['minItems', 'maxItems']) {
    if (schema[k] === undefined) continue;
    if (!heeft('array')) throw new SchemaFout(`${k} needs type array`, pad);
    if (!geheelNietNegatief(schema[k])) throw new SchemaFout(`${k} must be a non-negative integer`, pad);
    uit[k] = schema[k];
  }
  if (uit.minItems !== undefined && uit.maxItems !== undefined && uit.minItems > uit.maxItems) {
    throw new SchemaFout('minItems is larger than maxItems', pad);
  }
  if (schema.uniqueItems !== undefined) {
    if (!heeft('array') || typeof schema.uniqueItems !== 'boolean') throw new SchemaFout('uniqueItems must be a boolean on an array schema', pad);
    uit.uniqueItems = schema.uniqueItems;
  }
  if (schema.items !== undefined) {
    if (!heeft('array')) throw new SchemaFout('items needs type array', pad);
    uit.items = normaliseer(schema.items, `${pad}/items`, diepte + 1);
  }
  // Objecten
  if (schema.properties !== undefined) {
    if (!heeft('object')) throw new SchemaFout('properties needs type object', pad);
    if (!isPlatObject(schema.properties)) throw new SchemaFout('properties must be an object', pad);
    uit.properties = {};
    for (const [naam, sub] of Object.entries(schema.properties)) {
      if (!naam || naam.length > 128) throw new SchemaFout('property names must be 1-128 characters', pad);
      uit.properties[naam] = normaliseer(sub, `${pad}/properties/${naam}`, diepte + 1);
    }
  }
  if (schema.required !== undefined) {
    if (!heeft('object')) throw new SchemaFout('required needs type object', pad);
    if (!Array.isArray(schema.required) || schema.required.some((n) => typeof n !== 'string')
        || new Set(schema.required).size !== schema.required.length) {
      throw new SchemaFout('required must be a list of distinct property names', pad);
    }
    for (const n of schema.required) {
      if (!uit.properties || !Object.hasOwn(uit.properties, n)) throw new SchemaFout(`required property "${n}" is not in properties`, pad);
    }
    uit.required = [...schema.required];
  }
  if (schema.additionalProperties !== undefined) {
    if (!heeft('object')) throw new SchemaFout('additionalProperties needs type object', pad);
    if (typeof schema.additionalProperties !== 'boolean') throw new SchemaFout('additionalProperties must be true or false', pad);
    uit.additionalProperties = schema.additionalProperties;
  } else if (typen && typen.includes('object')) {
    uit.additionalProperties = false;
  }
  return uit;
}

function typeVan(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  if (isPlatObject(v)) return 'object';
  return typeof v;
}

function past(typen, v) {
  const t = typeVan(v);
  return typen.some((verwacht) => verwacht === t || (verwacht === 'number' && t === 'integer'));
}

const padDeel = (naam) => String(naam).replace(/~/g, '~0').replace(/\//g, '~1');

/**
 * Controleer een waarde tegen een GENORMALISEERD schema. Geeft de fouten als
 * [{ path, message }] (JSON-pointer, hooguit 20); een lege lijst is geldig.
 */
export function valideerWaarde(schema, waarde) {
  const fouten = [];
  controleer(schema, waarde, '', fouten);
  return fouten;
}

function controleer(schema, v, pad, fouten) {
  if (fouten.length >= MAX_FOUTEN) return;
  const meld = (message) => { if (fouten.length < MAX_FOUTEN) fouten.push({ path: pad || '/', message }); };
  if (typeof v === 'number' && !Number.isFinite(v)) { meld('must be a finite number'); return; }
  const typen = typenVan(schema);
  if (typen && !past(typen, v)) { meld(`must be ${typen.join(' or ')}`); return; }
  if (schema.const !== undefined && canoniekeJson(schema.const) !== canoniekeJson(v)) { meld(`must be ${JSON.stringify(schema.const)}`); return; }
  if (schema.enum !== undefined && !schema.enum.some((e) => canoniekeJson(e) === canoniekeJson(v))) {
    meld(`must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`);
    return;
  }
  if (typeof v === 'number') {
    if (schema.minimum !== undefined && v < schema.minimum) meld(`must be at least ${schema.minimum}`);
    if (schema.maximum !== undefined && v > schema.maximum) meld(`must be at most ${schema.maximum}`);
    if (schema.exclusiveMinimum !== undefined && v <= schema.exclusiveMinimum) meld(`must be more than ${schema.exclusiveMinimum}`);
    if (schema.exclusiveMaximum !== undefined && v >= schema.exclusiveMaximum) meld(`must be less than ${schema.exclusiveMaximum}`);
  } else if (typeof v === 'string') {
    const lengte = [...v].length;
    if (schema.minLength !== undefined && lengte < schema.minLength) meld(`must be at least ${schema.minLength} characters`);
    if (schema.maxLength !== undefined && lengte > schema.maxLength) meld(`must be at most ${schema.maxLength} characters`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(v)) meld(`must match ${schema.pattern}`);
    if (schema.format === 'local-path' && !isLokaalPad(v)) {
      meld('must be an absolute local path (no network share, device path, URL or ".." segment)');
    }
  } else if (Array.isArray(v)) {
    if (schema.minItems !== undefined && v.length < schema.minItems) meld(`must have at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && v.length > schema.maxItems) meld(`must have at most ${schema.maxItems} items`);
    if (schema.uniqueItems === true && new Set(v.map(canoniekeJson)).size !== v.length) meld('items must be unique');
    if (schema.items) v.forEach((item, i) => controleer(schema.items, item, `${pad}/${i}`, fouten));
  } else if (isPlatObject(v)) {
    const props = schema.properties || {};
    for (const naam of schema.required || []) {
      if (!Object.hasOwn(v, naam)) meld(`missing required property "${naam}"`);
    }
    for (const [naam, waarde] of Object.entries(v)) {
      if (Object.hasOwn(props, naam)) controleer(props[naam], waarde, `${pad}/${padDeel(naam)}`, fouten);
      else if (schema.additionalProperties !== true && (typen?.includes('object'))) {
        if (fouten.length < MAX_FOUTEN) fouten.push({ path: `${pad}/${padDeel(naam)}`, message: 'unknown property' });
      } else if (!isJsonWaarde(waarde)) {
        if (fouten.length < MAX_FOUTEN) fouten.push({ path: `${pad}/${padDeel(naam)}`, message: 'must be a JSON value' });
      }
    }
  }
}
