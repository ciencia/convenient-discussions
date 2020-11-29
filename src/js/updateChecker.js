/**
 * Module responsible for checking for updates of the page in background.
 *
 * @module updateChecker
 */

import Comment from './Comment';
import Section from './Section';
import cd from './cd';
import navPanel from './navPanel';
import toc from './toc';
import userRegistry from './userRegistry';
import {
  addNotification,
  closeNotifications,
  getNotifications,
  isLoadingOverlayOn,
  reloadPage,
} from './boot';
import { getUserGenders } from './apiWrappers';
import { keepWorkerSafeValues, unique } from './util';

let lastCheckedRevisionId;
let notifiedAbout;
let isBackgroundCheckArranged;
let previousVisitRevisionId;

const revisionData = {};
const checkedForNewEdits = {};

/**
 * Tell the worker to wake the script up after a given interval.
 *
 * Chrome and probably other browsers throttle background tabs. To bypass this, we use a web worker
 * to wake the script up when we say, making it work as an alarm clock.
 *
 * @param {number} interval
 * @private
 */
function setAlarmViaWorker(interval) {
  if (Number.isNaN(Number(interval))) return;
  cd.g.worker.postMessage({
    type: 'setAlarm',
    interval,
  });
}

/**
 * Remove an alarm set in `setAlarmViaWorker()`.
 *
 * @private
 */
function removeAlarmViaWorker() {
  cd.g.worker.postMessage({ type: 'removeAlarm' });
}

/**
 * Check for new comments in a web worker, update the navigation panel, and schedule the next check.
 *
 * @private
 */
async function checkForUpdates() {
  if (document.hidden && !isBackgroundCheckArranged) {
    const callback = () => {
      $(document).off('visibilitychange', callback);
      isBackgroundCheckArranged = false;
      removeAlarmViaWorker();
      checkForUpdates();
    };
    $(document).on('visibilitychange', callback);

    const interval = Math.abs(cd.g.BACKGROUND_UPDATE_CHECK_INTERVAL - cd.g.UPDATE_CHECK_INTERVAL);
    setAlarmViaWorker(interval * 1000);
    isBackgroundCheckArranged = true;
    return;
  }

  // Precaution
  isBackgroundCheckArranged = false;

  try {
    const revisions = await cd.g.CURRENT_PAGE.getRevisions({
      rvprop: ['ids'],
      rvlimit: 1,
    }, { noTimers: true });

    if (
      revisions.length &&
      revisions[0].revid !== (lastCheckedRevisionId || mw.config.get('wgRevisionId'))
    ) {
      await updateChecker.processPage();
      if (!revisionData[mw.config.get('wgRevisionId')]) {
        updateChecker.processPage(mw.config.get('wgRevisionId'));
      }
    }
  } catch (e) {
    if (e?.data && e.data.type !== 'network') {
      console.warn(e);
    }
  }

  if (document.hidden) {
    setAlarmViaWorker(cd.g.BACKGROUND_UPDATE_CHECK_INTERVAL * 1000);
    isBackgroundCheckArranged = true;
  } else {
    setAlarmViaWorker(cd.g.UPDATE_CHECK_INTERVAL * 1000);
  }
}

/**
 * If the revision of the current visit and previous visit are different, process the said
 * revisions. (We need to process the current revision too to get the comments' inner HTML without
 * any elements that may be added by scripts.) The revisions' data will finally processed by {@link
 * module:updateChecker~checkForEditsSincePreviousVisit checkForEditsSincePreviousVisit()}.
 *
 * @private
 */
async function processRevisionsIfNeeded() {
  const revisions = await cd.g.CURRENT_PAGE.getRevisions({
    rvprop: ['ids'],
    rvstart: new Date(cd.g.previousVisitUnixTime * 1000).toISOString(),
    rvlimit: 1,
  }, { noTimers: true });

  previousVisitRevisionId = revisions[0]?.revid;

  if (previousVisitRevisionId && previousVisitRevisionId !== mw.config.get('wgRevisionId')) {
    await updateChecker.processPage(previousVisitRevisionId);
    await updateChecker.processPage(mw.config.get('wgRevisionId'));
  }
}

/**
 * Check if there are changes made to the currently displayed comments since the previous visit.
 *
 * @private
 */
async function checkForEditsSincePreviousVisit() {
  const oldComments = revisionData[previousVisitRevisionId].comments;
  const currentComments = revisionData[mw.config.get('wgRevisionId')].comments;
  currentComments.forEach((currentComment) => {
    const oldComment = oldComments.find((oldComment) => currentComment.anchor === oldComment.anchor);
    if (oldComment) {
      if (oldComment.rawHtml !== currentComment.rawHtml) {
        const comment = Comment.getCommentByAnchor(currentComment.anchor);
        if (!comment) return;

        comment.addEditMark(true, true, previousVisitRevisionId);
      }
    }
  });
}

/**
 * Check if there are changes made to the currently displayed comments since they were rendered.
 *
 * @private
 */
async function checkForNewEdits() {
  const newComments = revisionData[lastCheckedRevisionId].comments;
  const currentComments = revisionData[mw.config.get('wgRevisionId')].comments;
  currentComments.forEach((currentComment) => {
    const newComment = newComments
      .find((newComment) => currentComment.anchor === newComment.anchor);
    if (newComment) {
      const comment = Comment.getCommentByAnchor(currentComment.anchor);
      if (!comment) return;

      if (newComment.rawHtml !== currentComment.rawHtml) {
        if (comment.$elements.length === 1 && newComment.elementsCount === 1) {
          comment.replaceElement(comment.$elements.first(), newComment.rawHtml);
          mw.hook('wikipage.content').add(comment.$elements);
          comment.addEditMark(false, true, lastCheckedRevisionId);
          comment.flashNewOnSight();
        } else {
          comment.addEditMark(false, false, lastCheckedRevisionId);
        }
      } else if (comment.isEdited) {
        comment.isEdited = false;
        comment.$elements
          .last()
          .find('.cd-editMark')
          .remove();
      }
      if (comment.isDeleted) {
        comment.unmarkAsDeleted();
      }
    } else {
      const comment = Comment.getCommentByAnchor(currentComment.anchor);
      if (!comment) return;

      comment.markAsDeleted();
    }
  });
}

/**
 * Send ordinary and desktop notifications to the user.
 *
 * @param {CommentSkeletonLike[]} comments
 * @private
 */
async function sendNotifications(comments) {
  const notifyAbout = comments.filter((comment) => (
    !notifiedAbout.some((commentNotifiedAbout) => commentNotifiedAbout.anchor === comment.anchor)
  ));

  let notifyAboutDesktop = [];
  if (cd.settings.desktopNotifications === 'all') {
    notifyAboutDesktop = notifyAbout;
  } else if (cd.settings.desktopNotifications === 'toMe') {
    notifyAboutDesktop = notifyAbout.filter((comment) => comment.toMe);
  }

  let notifyAboutOrdinary = [];
  if (cd.settings.notifications === 'all') {
    notifyAboutOrdinary = notifyAbout;
  } else if (cd.settings.notifications === 'toMe') {
    notifyAboutOrdinary = notifyAbout.filter((comment) => comment.toMe);
  }
  if (cd.settings.notifications !== 'none' && notifyAboutOrdinary.length) {
    // Combine with content of notifications that were displayed but are still open (i.e., the user
    // most likely didn't see them because the tab is in the background). In the past there could be
    // more than one notification, now there can be only one.
    const openNotification = getNotifications()
      .find((data) => data.comments && data.notification.isOpen);
    if (openNotification) {
      notifyAboutOrdinary.push(...openNotification.comments);
    }
  }

  if (notifyAboutOrdinary.length) {
    let html;
    const formsDataWillNotBeLost = cd.commentForms.some((commentForm) => commentForm.isAltered()) ?
      ' ' + cd.mws('parentheses', cd.s('notification-formdata')) :
      '';
    const reloadHtml = cd.sParse('notification-reload', formsDataWillNotBeLost);
    if (notifyAboutOrdinary.length === 1) {
      const comment = notifyAboutOrdinary[0];
      if (comment.toMe) {
        const where = comment.watchedSectionHeadline ?
          (
            cd.mws('word-separator') +
            cd.s('notification-part-insection', comment.watchedSectionHeadline)
          ) :
          cd.mws('word-separator') + cd.s('notification-part-onthispage');
        html = (
          cd.sParse('notification-toyou', comment.author.name, comment.author, where) +
          ' ' +
          reloadHtml
        );
      } else {
        html = (
          cd.sParse(
            'notification-insection',
            comment.author.name,
            comment.author,
            comment.watchedSectionHeadline
          ) +
          ' ' +
          reloadHtml
        );
      }
    } else {
      const isCommonSection = notifyAboutOrdinary.every((comment) => (
        comment.watchedSectionHeadline === notifyAboutOrdinary[0].watchedSectionHeadline
      ));
      let section;
      if (isCommonSection) {
        section = notifyAboutOrdinary[0].watchedSectionHeadline;
      }
      const where = (
        cd.mws('word-separator') +
        (
          section ?
          cd.s('notification-part-insection', section) :
          cd.s('notification-part-onthispage')
        )
      );
      let mayBeInterestingString = cd.s('notification-newcomments-maybeinteresting');
      if (!mayBeInterestingString.startsWith(',')) {
        mayBeInterestingString = cd.mws('word-separator') + mayBeInterestingString;
      }

      // "that may be interesting to you" text is not needed when the section is watched and the
      // user can clearly understand why they are notified.
      const mayBeInteresting = section && cd.g.thisPageWatchedSections?.includes(section) ?
        '' :
        mayBeInterestingString;

      html = (
        cd.sParse('notification-newcomments', notifyAboutOrdinary.length, where, mayBeInteresting) +
        ' ' +
        reloadHtml
      );
    }

    closeNotifications(false);
    const $body = cd.util.wrap(html);
    const notification = addNotification([$body], { comments: notifyAboutOrdinary });
    notification.$notification.on('click', () => {
      reloadPage({ commentAnchor: notifyAboutOrdinary[0].anchor });
    });
  }

  if (
    !document.hasFocus() &&
    Notification.permission === 'granted' &&
    notifyAboutDesktop.length
  ) {
    let body;
    const comment = notifyAboutDesktop[0];
    if (notifyAboutDesktop.length === 1) {
      if (comment.toMe) {
        const where = comment.section.headline ?
          cd.mws('word-separator') + cd.s('notification-part-insection', comment.section.headline) :
          '';
        body = cd.s(
          'notification-toyou-desktop',
          comment.author.name,
          comment.author,
          where,
          cd.g.CURRENT_PAGE.name
        );
      } else {
        body = cd.s(
          'notification-insection-desktop',
          comment.author.name,
          comment.author,
          comment.section.headline,
          cd.g.CURRENT_PAGE.name
        );
      }
    } else {
      const isCommonSection = notifyAboutDesktop.every((comment) => (
        comment.watchedSectionHeadline === notifyAboutDesktop[0].watchedSectionHeadline
      ));
      let section;
      if (isCommonSection) {
        section = notifyAboutDesktop[0].watchedSectionHeadline;
      }
      const where = section ?
        cd.mws('word-separator') + cd.s('notification-part-insection', section) :
        '';
      let mayBeInterestingString = cd.s('notification-newcomments-maybeinteresting');
      if (!mayBeInterestingString.startsWith(cd.mws('comma-separator'))) {
        mayBeInterestingString = cd.mws('word-separator') + mayBeInterestingString;
      }

      // "that may be interesting to you" text is not needed when the section is watched and the
      // user can clearly understand why they are notified.
      const mayBeInteresting = section && cd.g.thisPageWatchedSections?.includes(section) ?
        '' :
        mayBeInterestingString;

      body = cd.s(
        'notification-newcomments-desktop',
        notifyAboutDesktop.length,
        where,
        cd.g.CURRENT_PAGE.name,
        mayBeInteresting
      );
    }

    const notification = new Notification(mw.config.get('wgSiteName'), {
      body,

      // We use a tag so that there aren't duplicate notifications when the same page is opened in
      // two tabs. (Seems it doesn't work? :-/)
      tag: 'convenient-discussions-' + notifyAboutDesktop[notifyAboutDesktop.length - 1].anchor,
    });
    notification.onclick = () => {
      parent.focus();

      // Just in case, old browsers. TODO: delete?
      window.focus();

      reloadPage({
        commentAnchor: comment.anchor,
        closeNotificationsSmoothly: false,
      });
    };
  }

  notifiedAbout.push(...notifyAbout);
}

/**
 * Whether still an older revision of the page is displayed than that is retrieved or the content is
 * loading.
 *
 * @param {number} newRevisionId
 * @returns {boolean}
 * @private
 */
function isPageStillOutdated(newRevisionId) {
  return newRevisionId > mw.config.get('wgRevisionId') && !isLoadingOverlayOn();
}

/**
 * Object with the same basic structure as {@link module:CommentSkeleton} has. (It comes from a web
 * worker so its constuctor is lost.)
 *
 * @typedef {object} CommentSkeletonLike
 */

/**
 * Process the comments retrieved by a web worker.
 *
 * @param {CommentSkeletonLike[]} comments
 * @param {number} revisionId
 * @private
 */
async function processComments(comments, revisionId) {
  comments.forEach((comment) => {
    comment.author = userRegistry.getUser(comment.authorName);
    delete comment.authorName;
    if (comment.parentAuthorName) {
      comment.parent = {
        author: userRegistry.getUser(comment.parentAuthorName),
      };
      delete comment.parentAuthorName;
    }
  });

  // Extract "interesting" comments (that would make the new comments counter purple and might
  // invoke notifications). Keep in mind that we should account for the case where comments have
  // been removed. For example, the counter could be "+1" but then go back to displaying the refresh
  // icon which means 0 new comments.
  const newComments = comments
    .filter((comment) => comment.anchor && !Comment.getCommentByAnchor(comment.anchor));
  cd.debug.startTimer('filter interesting');
  const interestingNewComments = newComments.filter((comment) => {
    if (comment.isOwn || cd.settings.notificationsBlacklist.includes(comment.author.name)) {
      return false;
    }
    if (comment.toMe) {
      comment.interesting = true;
      return true;
    }
    if (!cd.g.thisPageWatchedSections) {
      return false;
    }

    if (comment.section) {
      // Is this section watched by means of an upper level section?
      const section = Section.search(comment.section);
      if (section) {
        const closestWatchedSection = section.getClosestWatchedSection(true);
        if (closestWatchedSection) {
          comment.watchedSectionHeadline = closestWatchedSection.headline;
          comment.interesting = true;
          return true;
        }
      }
    }
  });
  cd.debug.stopTimer('filter interesting');

  const authors = newComments
    .map((comment) => comment.author)
    .filter(unique);
  await getUserGenders(authors, { noTimers: true });

  if (!isPageStillOutdated(revisionId)) return;

  if (interestingNewComments[0]) {
    updateChecker.relevantNewCommentAnchor = interestingNewComments[0].anchor;
  } else if (newComments[0]) {
    updateChecker.relevantNewCommentAnchor = newComments[0].anchor;
  }

  const newCommentsBySection = Comment.groupBySection(newComments);
  const areThereInteresting = Boolean(interestingNewComments.length);
  navPanel.updateRefreshButton(newComments.length, newCommentsBySection, areThereInteresting);
  updateChecker.updatePageTitle(newComments.length, areThereInteresting);
  toc.addNewComments(newCommentsBySection);

  Section.addNewCommentsNotifications(newCommentsBySection);
  sendNotifications(interestingNewComments);
}

/**
 * Callback for messages from the worker.
 *
 * TODO: rewrite worker tasks using promises (which could be tricky).
 *
 * @param {Event} e
 * @private
 */
async function onMessageFromWorker(e) {
  const message = e.data;

  if (message.type === 'wakeUp') {
    checkForUpdates();
  }

  if (message.type === 'parse' && isPageStillOutdated(message.revisionId)) {
    lastCheckedRevisionId = message.revisionId;
    const { comments, sections } = message;
    toc.addNewSections(sections);
    await processComments(comments, message.revisionId);
    revisionData[message.revisionId] = { comments, sections };
  }

  if (message.type === 'parseRevision' && !revisionData[message.revisionId]) {
    const { comments, sections } = message;
    revisionData[message.revisionId] = { comments, sections };

    if (
      previousVisitRevisionId &&
      previousVisitRevisionId !== mw.config.get('wgRevisionId') &&
      revisionData[previousVisitRevisionId] &&
      revisionData[mw.config.get('wgRevisionId')]
    ) {
      checkForEditsSincePreviousVisit();
    }
  }

  if (
    lastCheckedRevisionId &&
    revisionData[lastCheckedRevisionId] &&
    revisionData[mw.config.get('wgRevisionId')] &&
    !checkedForNewEdits[lastCheckedRevisionId]
  ) {
    checkForNewEdits();
    checkedForNewEdits[lastCheckedRevisionId] = true;
  }
}

const updateChecker = {
  /**
   * Anchor of the comment that should be jumped to after reloading the page.
   *
   * @type {?string}
   * @memberof module:updateChecker
   */
  relevantNewCommentAnchor: null,

  /**
   * Initialize the update checker.
   *
   * @memberof module:updateChecker
   */
  init() {
    if (!cd.g.worker) return;

    notifiedAbout = [];
    this.relevantNewCommentAnchor = null;
    isBackgroundCheckArranged = false;
    previousVisitRevisionId = null;

    if (cd.g.worker.onmessage) {
      removeAlarmViaWorker();
    } else {
      cd.g.worker.onmessage = onMessageFromWorker;
    }

    setAlarmViaWorker(cd.g.UPDATE_CHECK_INTERVAL * 1000);

    if (cd.g.previousVisitUnixTime) {
      processRevisionsIfNeeded();
    }
  },

  /**
   * Process the current page in the worker context.
   *
   * @param {number} [revisionToParseId]
   * @memberof module:updateChecker
   */
  async processPage(revisionToParseId) {
    const {
      text,
      revid: revisionId,
    } = await cd.g.CURRENT_PAGE.parse({ oldid: revisionToParseId }, {
      noTimers: true,
      markAsRead: false,
    }) || {};
    cd.g.worker.postMessage({
      type: revisionToParseId ? 'parseRevision' : 'parse',
      revisionId,
      text,
      g: keepWorkerSafeValues(cd.g, ['IS_IPv6_ADDRESS', 'TIMESTAMP_PARSER']),
      config: keepWorkerSafeValues(cd.config, ['checkForCustomForeignComponents']),
    });
  },

  /**
   * Update the page title to show the number of comments added to the page since it was loaded.
   *
   * @param {number} newCommentsCount
   * @param {boolean} areThereInteresting
   * @memberof module:updateChecker
   */
  updatePageTitle(newCommentsCount, areThereInteresting) {
    const interestingMark = areThereInteresting ? '*' : '';
    const s = newCommentsCount ? `(${newCommentsCount}${interestingMark}) ` : '';
    document.title = document.title.replace(/^(?:\(\d+\*?\) )?/, s);
  },
};

export default updateChecker;
