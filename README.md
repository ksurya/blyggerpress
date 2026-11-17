# BlyggerPress

Your writing, your repository, your blog.

BlyggerPress is a browser-based editor for [Blygger](https://blygger.org/spec/0.4/) blogs. Write in Markdown, keep drafts, and publish a static website from your GitHub repository—on desktop or phone, without installing an app or running a server.

**[Open BlyggerPress →](https://ksurya.github.io/blyggerpress/)**

## Get started

1. **Connect GitHub.** Click the account icon in the top-right corner. Add a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) with **Contents: read and write** access to the repositories you want to use. Click **Test connection**.
2. **Add a blyg.** Choose a repository, branch, and publication folder. Open an existing blyg or start with an empty repository. The folder can be any path you choose, such as `docs`, `blog`, or `website/notes`.
3. **Make it yours.** Set the title, author, and published URL. Optionally add a profile picture and navigation links.
4. **Write your first post.** Use Markdown and preview it as you go. Start with a heading if you want a title.

One GitHub connection works across all your blygs. Use the name in the top-left corner to switch between them or add another.

## Write, review, publish

Drafts save automatically **in the current browser**. Clicking **Publish** prepares the website files; it does not send them to GitHub yet.

Open **Changes** to review the files, enter a commit message, and choose **Commit changes**. This saves pending drafts, settings, and prepared posts to GitHub. If your blog has automatic deployment configured, that commit can trigger its deployment.

BlyggerPress generates a homepage with your newest 20 posts, an archive, individual post pages, and an RSS feed. Point your static host at your chosen publication folder to put the blog online. Connecting a repository does not configure hosting for you.

## Continue on another device

Open BlyggerPress, connect GitHub, and select the same repository, branch, and folder. Use **Pull latest** to load committed changes.

Uncommitted work stays in the browser where you wrote it. Commit before switching devices, or use **Download backup** in Changes to keep a copy.

If two devices edit the same content, BlyggerPress keeps your local work and stops the conflicting update. Under **Changes → Other options**, use **Save to a new branch**, then follow the link to review and resolve the changes on GitHub. Some conflicts may need another Git client.

## Customize your blyg

In **Settings → Blog details**, edit your title, author, published URL, profile-picture URL, and navigation links. Enter one link per line:

```text
About | /about/
Contact | mailto:hello@example.com
```

Home and Archive are included automatically. Saving details prepares updated pages for your next commit.

To change the publication folder later, go to **Settings → Repository & folders → Published output → Change folder**. Review and commit the new files, then update your hosting configuration. Previous published files remain in place, and the public URL stays unchanged.

## Where your work lives

- **Published website:** your chosen publication folder.
- **Drafts and project settings:** the separate `.blyggerpress/` directory in your repository after you commit.
- **Uncommitted changes:** this browser, until you commit or download them.

Deploy only the publication folder. **Unpublished does not mean private:** drafts in a public GitHub repository are readable on GitHub. If you publish from the repository root, exclude `.blyggerpress/` from deployment.

## GitHub access and removing a blyg

Choose **Remember on this device** to keep your token between visits, or leave it unchecked for the current session only. You can test, replace, or forget it from the account icon. Your token is sent to GitHub and is never included in blog files or backups. Only remember it on a device and app installation you trust.

Use **Settings → Remove blyg** to remove a blyg from this browser. Your GitHub repository and published site stay untouched. **Commit or download uncommitted changes first.** Undo can restore the removed workspace; reopening the repository only restores committed work.

## Feedback

Found a bug or have an idea? [Open an issue](https://github.com/ksurya/blyggerpress/issues).

For development, architecture, testing, and deployment instructions, see [AGENTS.md](AGENTS.md).
