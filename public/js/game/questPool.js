// questPool.js — plain data. This is a config file: edit it freely, it is the app's content.
// R-6 says the answer to fading engagement is MORE CONTENT, not more mechanics. Grow this file.
// Fields: id (stable, used for cooldowns), name, description, difficulty 1–5.

export const QUEST_POOL = {
  status: [
    { id: 'st-ship', name: 'Ship in public', description: 'Put one visible piece of work where other people can see it.', difficulty: 4 },
    { id: 'st-profile', name: 'Update the record', description: 'Refresh your portfolio or profile with your latest project.', difficulty: 2 },
    { id: 'st-brag', name: 'Brag-worthy act', description: "Do one thing today that future-you would brag about.", difficulty: 3 },
  ],
  money: [
    { id: 'mo-subs', name: 'Audit the leaks', description: 'Review every subscription. Cancel one.', difficulty: 2 },
    { id: 'mo-log', name: 'Full ledger', description: 'Log every dollar that leaves your account today.', difficulty: 1 },
    { id: 'mo-rev', name: 'Revenue block', description: '30 minutes on a revenue idea for OpbrAutobot or the next product.', difficulty: 3 },
  ],
  health: [
    { id: 'he-walk', name: 'Move anyway', description: '20 minutes of movement. Especially on a bad day.', difficulty: 2 },
    { id: 'he-train', name: 'Full session', description: 'A complete workout. Not a token one.', difficulty: 4 },
    { id: 'he-steps', name: '10,000 steps', description: 'Move until the counter says so.', difficulty: 3 },
    { id: 'he-sleep', name: 'Lights out', description: 'In bed by your target time, phone outside arm\'s reach.', difficulty: 3 },
  ],
  intelligence: [
    { id: 'in-read', name: '25 pages', description: 'Nonfiction. Pages, not minutes.', difficulty: 2 },
    { id: 'in-tech', name: 'New technique', description: 'Learn one new technique in your stack. Write five lines about it.', difficulty: 3 },
    { id: 'in-finish', name: 'Finish it', description: 'Complete one tutorial or lesson end to end. No half-watching.', difficulty: 3 },
  ],
  discipline: [
    { id: 'di-deep', name: 'Deep work: 90', description: '90 minutes, phone in another room. No exceptions.', difficulty: 4 },
    { id: 'di-cold', name: 'Cold shower', description: 'All the way cold. All the way through.', difficulty: 2 },
    { id: 'di-avoid', name: 'The avoided thing', description: "Do the task you've been avoiding longest — first, before anything else.", difficulty: 5 },
  ],
  social: [
    { id: 'so-new', name: 'Cold open', description: 'Start a conversation with someone you have never spoken to.', difficulty: 4 },
    { id: 'so-compliment', name: 'Specific praise', description: 'Give one genuine, specific compliment. Vague ones do not count.', difficulty: 1 },
    { id: 'so-post', name: 'Break the lurk', description: "Post or comment somewhere you'd normally just read.", difficulty: 2 },
  ],
  looks: [
    { id: 'lo-groom', name: 'Full maintenance', description: 'Grooming routine, top to bottom.', difficulty: 2 },
    { id: 'lo-fit', name: 'Deliberate fit', description: "Plan and lay out tomorrow's outfit on purpose.", difficulty: 1 },
    { id: 'lo-skin', name: 'AM + PM', description: 'Skincare both ends of the day. No skips.', difficulty: 2 },
  ],
  relationships: [
    { id: 're-call', name: 'Voice, not text', description: 'Call a family member. Actually call.', difficulty: 3 },
    { id: 're-plan', name: 'Concrete plan', description: 'Make a real plan with a friend — day, time, place.', difficulty: 2 },
    { id: 're-thanks', name: 'Say it', description: 'Write one message of genuine appreciation to someone.', difficulty: 1 },
  ],
  network: [
    { id: 'ne-reach', name: 'Cold outreach', description: 'Reach out to one person in your field.', difficulty: 4 },
    { id: 'ne-reply', name: 'Contribute', description: 'Reply thoughtfully in a community you value. OPBR and dev circles count.', difficulty: 2 },
    { id: 'ne-follow', name: 'Close the loop', description: 'Follow up with someone you said "we should talk" to.', difficulty: 3 },
  ],
  productivity: [
    { id: 'pr-plan', name: 'Five lines', description: "Plan tomorrow tonight. Five lines, written before you sleep.", difficulty: 1 },
    { id: 'pr-zero', name: 'Zero out', description: 'Inbox and notifications to zero.', difficulty: 2 },
    { id: 'pr-maker', name: 'Maker before consumer', description: 'Two hours of making before you consume anything today.', difficulty: 4 },
  ],
  // potential: intentionally absent — it is derived, not trainable (§5.3).
};
