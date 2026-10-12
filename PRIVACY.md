# DayDesk Privacy Policy

Last updated: October 12, 2026

## The short version

DayDesk keeps everything on your own computer. It has no servers, collects no analytics and sends your email and messages to no one.

- **Local only.** Your email, WhatsApp messages and to-do list are stored in a file on your Mac and nowhere else.
- **Read-only.** DayDesk never sends, deletes, moves or marks anything in your mailbox or WhatsApp.
- **You choose what it reads.** It reads one email account you connect, and only the WhatsApp chats you add to its watch list.
- **No selling, no sharing, no tracking.** The developer never receives your data, so there is nothing to sell or share.
- **You can delete it all.** Disconnecting your account or removing DayDesk's folder erases everything it stored.

## What DayDesk is

DayDesk turns your email and chosen WhatsApp chats into a daily to-do list, shown in Chrome's side panel. It has two parts, and both run on your computer:

- **The DayDesk extension** for Google Chrome shows your Today board, settings and the email reader.
- **The DayDesk helper** is a small app on your Mac. It connects to your email provider, finds tasks in your mail and stores everything locally.

The extension talks only to the helper, over a connection that never leaves your computer. This policy covers both parts.

## Information DayDesk accesses

DayDesk reads only what it needs to build your to-do list, and only from sources you connect.

| Information | What exactly | When |
| --- | --- | --- |
| Email messages | Sender, recipients, subject, date and read/starred state of messages in your Inbox and Sent folders; the text of recent Inbox messages; names and sizes of attachments (not their contents) | After you connect an email account |
| Email password | The app password you create for DayDesk (not your main account password) | When you connect an account |
| WhatsApp messages | Text, sender name, chat name and time of messages in the chats on your watch list, as shown in your own WhatsApp Web tab | Only for chats you add to the watch list, while WhatsApp Web is open |
| WhatsApp chat names | The names of chats visible in your chat list, so DayDesk can suggest chats to watch | While WhatsApp Web is open |
| Your to-do list | Tasks DayDesk finds, tasks you add, and what you tick off, delete or postpone | As you use DayDesk |
| Settings | Pairing code, watch list, theme and style choices | As you use DayDesk |

DayDesk does not read WhatsApp chats that are not on your watch list, photos, voice notes, files, contacts or calls. It does not read any other website you visit.

## How DayDesk uses it

DayDesk uses your information only to show you your own to-do list. Specifically, it:

- Finds tasks in your email and watched chats, such as bills to pay, documents to sign and requests to reply to, with their amounts and due dates.
- Links an email and a WhatsApp message when they are about the same task, so you see one task instead of two.
- Shows the Today board, the original email or message behind each task, and a notification on your Mac when a new task appears.
- Recognises messages you sent to yourself, so it does not show your own name on your tasks.

All of this runs on your computer, using fixed rules. DayDesk does not use your information for advertising, profiling, credit or lending decisions, or training any model.

## Where your information is stored

Everything DayDesk stores stays on your computer, in three places:

| Place | What it holds |
| --- | --- |
| A database file in the hidden `.daydesk` folder in your home folder | Email messages, watched WhatsApp messages, your to-do list and its history |
| The macOS Keychain | Your email app password, protected by macOS |
| Chrome's storage for the DayDesk extension | Pairing code, WhatsApp watch list and connection status, theme and style choices |

The developer of DayDesk runs no servers and never receives a copy of any of this. Your email password is never written to the database or to Chrome's storage.

## What DayDesk does not do

- It does not send your data to the developer or to any server the developer controls.
- It does not sell, rent, share or transfer your data to anyone.
- It does not use analytics, crash reporting, tracking pixels or advertising.
- It does not send your email or messages to any AI service. Tasks are found by rules that run on your computer.
- It never changes your mailbox: it opens folders read-only, so reading a message in DayDesk does not even mark it as read.
- It never types, sends, clicks or opens anything in WhatsApp. It only reads what your WhatsApp Web tab already shows.

## Third-party services

DayDesk connects directly from your computer to services you already use. No data passes through the developer on the way.

- **Your email provider.** The helper signs in to Yahoo Mail (or Gmail, once available) over an encrypted IMAP connection to read your mail. Your provider's own privacy policy covers that service.
- **WhatsApp Web.** DayDesk reads the WhatsApp Web page you have open in Chrome. It makes no separate connection to WhatsApp. WhatsApp's own privacy policy covers WhatsApp.

DayDesk does not load fonts, scripts or images from the internet into its panel. Images inside an email are blocked until you choose to load them for that message.

## Browser permissions and why DayDesk needs them

| Permission | Why |
| --- | --- |
| Side panel | To show the Today board beside the page you are on, only in the tab where you open it |
| Storage | To remember your pairing code, WhatsApp watch list and display choices |
| Access to `127.0.0.1:4287` | To talk to the DayDesk helper on your own computer. This address cannot be reached from the internet |
| Read `web.whatsapp.com` | To read messages from the chats on your watch list in your open WhatsApp Web tab |

DayDesk asks for no access to any other website, your browsing history, your tabs or your location.

## How long it is kept and how to delete it

DayDesk keeps your data on your computer until you delete it. On first sync it stores your newest 1,000 Inbox and Sent messages, then keeps new mail as it arrives. WhatsApp messages are stored only from chats on your watch list and are checked for tasks for 7 days.

You can delete data at any time:

- **A task or a linked message:** use the delete button on its card. It is gone from your list and will not come back.
- **WhatsApp chats:** remove a chat from the watch list in Sources, and DayDesk stops reading it.
- **Your email account:** choose *Change account* in Sources. This deletes that account's stored mail, its tasks and its password from your computer.
- **Everything:** remove the DayDesk extension from Chrome, stop the helper, and delete the `.daydesk` folder in your home folder.

Because the developer holds no copy of your data, there is nothing for the developer to delete on your behalf.

## How DayDesk protects your information

- **Local connection only.** The helper accepts connections only from your own computer, never from your network or the internet.
- **Pairing code.** Every request to the helper must carry a secret pairing code, so other websites and apps on your computer cannot read your data through it.
- **Encrypted email connection.** The helper connects to your email provider over TLS.
- **Passwords in the Keychain.** Your email app password is kept in the macOS Keychain, not in a plain file.
- **Safe email display.** Emails are shown in a sandbox where scripts cannot run, and remote images (often used to track when you open mail) stay blocked unless you allow them.

No software is perfectly secure. Keep your Mac's login password private and your system up to date.

## Chrome Web Store Limited Use

The use of information that DayDesk receives complies with the Chrome Web Store User Data Policy, including its Limited Use requirements. In particular, DayDesk:

- Uses your data only to provide its single purpose: turning your email and chosen chats into a to-do list.
- Does not transfer your data to third parties, except to your own email provider as needed to read your mail.
- Does not use or transfer your data for advertising, for creditworthiness or lending, or to sell it.
- Allows no human, including the developer, to read your data.

## Children

DayDesk is not directed at children under 13 and does not knowingly collect information from them.

## Changes to this policy

If DayDesk starts handling information differently, this policy will be updated before the change ships, and the date at the top will change. A change that sends data off your computer would be announced in the extension before it takes effect.

## Contact

Questions about this policy or DayDesk's privacy: [neerajxp@gmail.com](mailto:neerajxp@gmail.com).

DayDesk's source code is public at [github.com/neerajxp/DayDesk](https://github.com/neerajxp/DayDesk), so anyone can check how it handles data.
