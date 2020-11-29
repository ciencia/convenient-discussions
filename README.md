# Convenient Discussions ![lic](https://img.shields.io/github/license/jwbth/convenient-discussions)
<img align="right" width="200" src="https://upload.wikimedia.org/wikipedia/commons/thumb/d/d0/Convenient_Discussions_logo_color_textless.svg/200px-Convenient_Discussions_logo_color_textless.svg.png" />

**Convenient Discussions** (**CD**) is a JavaScript tool providing a shell over the existing [MediaWiki](https://www.mediawiki.org/) discussion system that enhances user experience with talk pages in multiple ways.

## Features
The script features include:
* posting and editing comments without switching to a separate page;
  * @mentions, [[#comment links]], [[wikilinks]], {{templates}}, and \<tags> autocomplete;
  * autofilling the edit summary with indication of the addressee of the comment;
  * saving comment drafts to restore the forms' content after unexpected events such as browser crashes;
* creating topics and subsections;
* highlighting and navigating new comments (via the navigation panel or table of contents);
* highlighting own comments;
* desktop notifications about replies to the user's comments and comments in watched sections on open pages (opt-in);
* watching sections, which affects notifications and highlighting edits on pages that list revisions;
* jumping to a specific comment from the watchlist and other pages that list revisions;
* moving topics between talk pages;
* thanking for and copying links to edits that added comments;
* slightly redesigned discussion threads that make it easier to follow which comment replies to which.

The script makes the user forget about:
* the need to search the code for a place for a comment, count colons, type tildes and other markup;
* edit conflicts;
* reading talk pages through diffs;
* the need to completely reload the page and look for new comments with eyes, or even check the watchlist.

A limitation of the script is that it works only in modern browsers, i.e., doesn't support Internet Explorer.

## Credits
Convenient Discussions is being developed by Jack who built the house since 2017, enriched by the contributions and feedback from the Russian Wikipedia tech community and users. It also borrows the code for parsing timestamps in different formats from Matma Rex and uses solutions and ideas from the Wikimedia engineering and design teams.

## See also
* For documentation, see [the script's homepage](https://commons.wikimedia.org/wiki/User:Jack_who_built_the_house/Convenient_Discussions).
* Please file issues on Wikimedia Phabricator under [the tag "Convenient-Discussions"](https://phabricator.wikimedia.org/tag/convenient-discussions/).
* If you want to help with localization, see [the translatewiki.net project](https://translatewiki.net/wiki/Translating:Convenient_Discussions).
