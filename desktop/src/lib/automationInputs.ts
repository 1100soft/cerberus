export type AutomationInput={name:string;key?:string;label?:string;type:'text'|'number'|'boolean'|'choice';options?:string[];defaultValue?:string;required?:boolean};
export type AutomationInputValues=Record<string,string|number|boolean>;
// key/label preserve identifiers in inputs saved before the single-name UI.
export function scriptInputName(name:string){
 if(/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))return name;
 const normalized=name.normalize('NFKD').replace(/\p{M}/gu,'').replace(/[^A-Za-z0-9_]+/g,'_').replace(/^_+|_+$/g,'').toLowerCase();
 if(normalized)return /^[0-9]/.test(normalized)?`input_${normalized}`:normalized;
 let hash=2166136261;for(const char of name)hash=Math.imul(hash^char.codePointAt(0)!,16777619);
 return `input_${(hash>>>0).toString(16)}`;
}
export function inputName(input:AutomationInput){return input.label||input.name;}
export function inputKey(input:AutomationInput){return input.key||(input.label?input.name:scriptInputName(input.name));}
export function unifyInput(input:AutomationInput):AutomationInput{const name=inputName(input),key=inputKey(input);const {label:_,...rest}=input;return {...rest,name,key:key===scriptInputName(name)?undefined:key};}
export function inputDefinitionsError(inputs:AutomationInput[]){
 const names=new Set<string>();
 for(const input of inputs){if(!['text','number','boolean','choice'].includes(input.type))return 'Choose a supported input type.';if(input.type==='boolean'&&input.defaultValue&&!['true','false'].includes(input.defaultValue))return 'Boolean defaults must be true or false.';const name=inputKey(input).toUpperCase();if(!inputName(input).trim())return 'Name each input.';if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(inputKey(input)))return 'Invalid saved input identifier.';if(names.has(name))return 'These input names generate the same script variable. Rename one.';names.add(name);if(input.type==='choice'&&(!input.options?.length||input.options.some(value=>!value.trim())||new Set(input.options).size!==input.options.length))return 'Choices need distinct, nonempty options.';if(input.defaultValue&&input.type==='number'&&!Number.isFinite(Number(input.defaultValue)))return 'Number defaults must be finite numbers.';if(input.defaultValue&&input.type==='choice'&&!input.options?.includes(input.defaultValue))return 'A choice default must match an option.';}
 return '';
}
export function initialInputValues(inputs:AutomationInput[]):AutomationInputValues{return Object.fromEntries(inputs.map(input=>[inputKey(input),input.type==='boolean'?input.defaultValue==='true':input.type==='choice'?input.defaultValue||input.options?.[0]||'':input.defaultValue||'']));}
export function resolveInputValues(inputs:AutomationInput[],supplied:AutomationInputValues):AutomationInputValues{
 const error=inputDefinitionsError(inputs);if(error)throw Error(error);
 const result:AutomationInputValues=Object.create(null),defaults=initialInputValues(inputs);
 for(const input of inputs){const key=inputKey(input);const value=Object.hasOwn(supplied,key)?supplied[key]:defaults[key];if(input.type==='boolean'){if(typeof value!=='boolean')throw Error(`${input.name}: choose true or false.`);result[key]=value;continue;}if(value===''||value===undefined){if(input.required!==false)throw Error(`${inputName(input)} is required.`);result[key]='';continue;}if(input.type==='number'){if(!['string','number'].includes(typeof value)||String(value).trim()===''||!Number.isFinite(Number(value)))throw Error(`${input.name}: enter a finite number.`);result[key]=Number(value);}else{if(typeof value!=='string'||value.includes('\0'))throw Error(`${input.name}: enter text without null characters.`);if(input.type==='choice'&&!input.options?.includes(value))throw Error(`${input.name}: choose an available option.`);result[key]=value;}}
 return result;
}
export function inputEnvironment(values:AutomationInputValues){return Object.fromEntries(Object.entries(values).map(([name,value])=>[`CERBERUS_INPUT_${name.toUpperCase()}`,String(value)]));}
