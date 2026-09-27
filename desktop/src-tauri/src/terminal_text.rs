/// Incremental plain-text decoder for streamed installer output (CSI, OSC and UTF-8).
#[derive(Default)]
pub struct TerminalText {
    escape: u8,
    pending: Vec<u8>,
}
impl TerminalText {
    pub fn push(&mut self, bytes: &[u8]) -> String {
        for &byte in bytes {
            match self.escape {
                1 => {
                    self.escape = match byte {
                        b'[' => 2,
                        b']' => 3,
                        _ => 0,
                    }
                }
                2 => {
                    if (0x40..=0x7e).contains(&byte) {
                        self.escape = 0;
                    }
                }
                3 => {
                    if byte == 7 {
                        self.escape = 0;
                    } else if byte == 27 {
                        self.escape = 4;
                    }
                }
                4 => self.escape = if byte == b'\\' { 0 } else { 3 },
                _ => match byte {
                    27 => self.escape = 1,
                    b'\r' => self.pending.push(b'\n'),
                    b'\n' | b'\t' | 32..=255 => self.pending.push(byte),
                    _ => (),
                },
            }
        }
        let mut result = String::new();
        loop {
            match std::str::from_utf8(&self.pending) {
                Ok(text) => {
                    result.push_str(text);
                    self.pending.clear();
                    break;
                }
                Err(error) => {
                    let valid = error.valid_up_to();
                    result.push_str(std::str::from_utf8(&self.pending[..valid]).unwrap());
                    if let Some(length) = error.error_len() {
                        result.push('\u{fffd}');
                        self.pending.drain(..valid + length);
                    } else {
                        self.pending.drain(..valid);
                        break;
                    }
                }
            }
        }
        result
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn split_sequences_and_carriage_return_progress_are_visible() {
        let mut text = TerminalText::default();
        assert_eq!(text.push(b"\x1b[1"), "");
        assert_eq!(text.push(b"A\x1b[2K25%\r50%"), "25%\n50%");
        assert_eq!(text.push(b"\x1b]0;title\x1b"), "");
        assert_eq!(text.push(b"\\done\n"), "done\n");
        assert_eq!(text.push(&[0xe2, 0x9c]), "");
        assert_eq!(text.push(&[0x93]), "✓");
    }
}
