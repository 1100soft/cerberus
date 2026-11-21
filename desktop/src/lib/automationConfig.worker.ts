import {parseWorkflowProposal} from './automationConfig';
self.onmessage=event=>{
 const {text,current,jobs,repositoryIds,profiles}=event.data;
 try{self.postMessage({jobs:parseWorkflowProposal(text,current,jobs,repositoryIds,profiles)});}
 catch(error){self.postMessage({error:String(error)});}
};
