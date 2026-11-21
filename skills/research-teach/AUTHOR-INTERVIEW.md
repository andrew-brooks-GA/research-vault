# Help an author write a profile

Read this only when a person asks for help writing a profile. Work toward a draft mission, ask the author to confirm it, and keep it as a vault snippet as `MISSION-FORMAT.md` says. Use no word of this skill without a plain gloss.

With a document, anything that says what a learner should be able to do, capture it as a source first with its text stored. For a document on disk, run `capture --type source --title <title> --url file://<absolute path> --content-file <path> --store-body --ack-data-egress`. Say that the address of such a source is a path on the machine that captured it, and that in the one trial `refresh` answered `unreachable` for it, with `refused non-https url: file://`. In one probe the entry kept its stored text after the file was removed. Show the author the part of the document that was read. Propose a draft from it, say what the document did not give, and say that more documents can be given.

Ask one item in each turn through the host's question dialog when one exists:

1. Who is the profile for?
2. What changes for a learner who has this, in your words?
3. What must a learner be able to do at the end? Ask for things a person could watch.
4. What is out of scope?
5. Which options should it set? Name each option in the table in `MISSION-FORMAT.md` in plain words with its values, since the author cannot see the table. Say that a profile never sets what a learner knows or where a learner can do a task.
6. Should it come with a path? If so, ask for its lessons in order, written with every term taken as new. The author gives the lesson titles in order. Write each line's `terms:`, `tool:` and `after:` values and the `Project:` and `Review` lines that `PATH-FORMAT.md` asks for. Show each thing you added as your own and ask the author to confirm it. A lesson that teaches both terms and a tool becomes two lines.

Write the answer to "who is it for" as the first sentence of `## Why`, with the reason after it.

Before the item on what a learner must be able to do, search the vault as `SKILL.md` section 2, item 2 does. When entries come back, offer their subjects. When none comes back, ask the item with no options and do not offer to capture a page. Never ask the author what a learner knows.

Show the whole draft, with what you added marked as yours, before asking the author to confirm it. Say what happens after: you check and capture the profile as `MISSION-FORMAT.md` says and give the author the entry's id. Say that a learner starts from it by asking this skill for a profile and can adjust any part of it. An author who wants one fixed course builds the workspace and exports it.
