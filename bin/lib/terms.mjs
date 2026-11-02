// Query and title terms, shared by the pre-web hook and advise's near-duplicate pairing.
export const STOP = new Set('the a an and or of to in on for with how what why does is are was be this that from into about using use vs return full page text summarize paper extract verbatim'.split(' '));

// Lower-cased, URLs blanked, split outside [a-z0-9_.-], terms shorter than three characters and
// stop words dropped, deduplicated in first-occurrence order.
export const termsOf = text => [...new Set(String(text ?? '').toLowerCase().replace(/https?:\/\/\S+/g, ' ').split(/[^a-z0-9_.-]+/).filter(t => t.length >= 3 && !STOP.has(t)))];
