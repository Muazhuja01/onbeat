/**
 * Everyday English words that can start a reply. A capitalised first word that is not
 * in this list is checked as a possible name, so "Jen helped me" needs a source but
 * "Large, please." doesn't. Add ordinary words here when a good reply is blocked;
 * never add names.
 */
export const COMMON_WORDS: ReadonlySet<string> = new Set([
  "a", "about", "absolutely", "actually", "after", "again", "ah", "all", "almost", "alright", "also", "always", "an", "and",
  "another", "any", "anything", "anyway", "are", "around", "as", "ask", "at", "awesome", "back", "be", "because", "been",
  "before", "better", "black", "both", "busy", "but", "by", "can", "can't", "card", "cash", "certainly", "check", "coffee",
  "come", "cool", "could", "cup", "decaf", "definitely", "did", "didn't", "do", "does", "doing", "don't", "done", "each",
  "either", "enjoy", "even", "every", "everything", "excuse", "exactly", "fine", "first", "for", "from", "give", "glad",
  "go", "going", "good", "got", "great", "ha", "had", "happy", "has", "have", "he", "he's", "hello", "her", "here", "hey",
  "hi", "his", "hmm", "hold", "home", "hot", "how", "iced", "if", "in", "is", "isn't", "it", "it's", "just", "large",
  "last", "later", "latte", "let", "let's", "like", "little", "look", "lots", "lovely", "maybe", "me", "medium", "milk",
  "mine", "more", "morning", "most", "much", "my", "never", "next", "nice", "no", "none", "nope", "not", "nothing", "now",
  "of", "off", "oh", "on", "once", "one", "only", "or", "other", "our", "out", "over", "pardon", "perfect", "perhaps",
  "please", "pretty", "probably", "quite", "ready", "really", "regular", "right", "same", "say", "see", "send", "she", "she's",
  "should", "small", "so", "some", "someone", "something", "sometimes", "soon", "sorry", "sounds", "still", "sugar",
  "sure", "take", "tea", "tell", "thank", "thanks", "that", "that's", "the", "their", "them", "then", "there", "there's",
  "these", "they", "they're", "third", "this", "those", "though", "to", "toast", "today", "together", "too", "totally",
  "try", "two", "um", "until", "up", "us", "usual", "very", "wait", "was", "water", "we", "we're", "welcome", "well",
  "were", "what", "what's", "when", "where", "which", "while", "who", "why", "will", "with", "without", "won't", "would",
  "wow", "yeah", "yes", "yep", "yet", "you", "you're", "your", "yours",
]);
