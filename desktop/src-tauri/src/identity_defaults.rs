/// Keep an explicit, connected choice; otherwise use the sole connected account.
pub fn reconcile(current: &mut Option<String>, connected: &[String]) -> bool {
    if current.as_ref().is_some_and(|id| connected.contains(id)) { return false; }
    let next = (connected.len() == 1).then(|| connected[0].clone());
    if *current == next { return false; }
    *current = next;
    true
}

#[cfg(test)]
mod tests {
    use super::reconcile;
    #[test]
    fn sole_account_becomes_default_and_existing_choice_is_remembered() {
        let mut current = None;
        assert!(reconcile(&mut current, &["one".into()]));
        assert_eq!(current.as_deref(), Some("one"));
        assert!(!reconcile(&mut current, &["one".into(), "two".into()]));
        assert_eq!(current.as_deref(), Some("one"));
        assert!(reconcile(&mut current, &["two".into()]));
        assert_eq!(current.as_deref(), Some("two"));
        assert!(reconcile(&mut current, &[]));
        assert!(current.is_none());
    }
}
