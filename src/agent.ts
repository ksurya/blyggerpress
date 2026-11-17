import {createAgent,registerTools} from '@ui-sdk/react/agent';
export const agent=createAgent({allow:step=>!step.confirm||window.confirm(step.confirm)});
registerTools(agent,{allow:()=>true});
Object.defineProperty(window,'blyggerAgent',{value:agent,configurable:true});
