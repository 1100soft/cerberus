use std::{collections::HashMap, sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}}};

#[derive(Default)]
pub struct DraftRuns(Mutex<HashMap<String, Arc<AtomicBool>>>);

pub struct Registration { id: String, runs: Arc<DraftRuns>, pub cancelled: Arc<AtomicBool> }
impl DraftRuns {
    pub fn register(self: &Arc<Self>, id: String) -> Result<Registration, String> {
        if id.len() > 128 || id.is_empty() || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-') { return Err("Invalid draft request ID".into()); }
        let flag=Arc::new(AtomicBool::new(false));
        let mut entries=self.0.lock().map_err(|e|e.to_string())?;
        if entries.contains_key(&id){return Err("Draft request ID is already in use".into());}
        entries.insert(id.clone(),flag.clone());
        Ok(Registration{id,runs:self.clone(),cancelled:flag})
    }
    pub fn cancel(&self,id:&str)->Result<(),String>{
        if let Some(flag)=self.0.lock().map_err(|e|e.to_string())?.get(id){flag.store(true,Ordering::SeqCst);}
        Ok(())
    }
}
impl Drop for Registration { fn drop(&mut self){if let Ok(mut entries)=self.runs.0.lock(){entries.remove(&self.id);}} }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_the_selected_run_is_cancelled_and_registration_is_released() {
        let runs=Arc::new(DraftRuns::default());
        let first=runs.register("first".into()).unwrap();
        let second=runs.register("second".into()).unwrap();
        assert!(runs.register("first".into()).is_err());
        runs.cancel("first").unwrap();
        assert!(first.cancelled.load(Ordering::SeqCst));
        assert!(!second.cancelled.load(Ordering::SeqCst));
        drop(first);
        assert!(runs.register("first".into()).is_ok());
    }
}
