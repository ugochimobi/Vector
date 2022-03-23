// Enable Vector features limited to ES6 browse
const
	searchToggle = require( './searchToggle.js' ),
	stickyHeader = require( './stickyHeader.js' ),
	scrollObserver = require( './scrollObserver.js' ),
	initExperiment = require( './AB.js' ),
	initSectionObserver = require( './sectionObserver.js' ),
	initTableOfContents = require( './tableOfContents.js' ),
	deferUntilFrame = require( './deferUntilFrame.js' ),
	TOC_ID = 'mw-panel-toc',
	LEGACY_TOC_ID = 'toc',
	BODY_CONTENT_ID = 'bodyContent',
	HEADLINE_SELECTOR = '.mw-headline',
	TOC_SECTION_ID_PREFIX = 'toc-',
	ABTestConfig = require( /** @type {string} */ ( './config.json' ) ).wgVectorWebABTestEnrollment || {};

/**
 * @return {void}
 */
const main = () => {
	// Initialize the search toggle for the main header only. The sticky header
	// toggle is initialized after wvui search loads.
	const searchToggleElement = document.querySelector( '.mw-header .search-toggle' );
	if ( searchToggleElement ) {
		searchToggle( searchToggleElement );
	}

	// If necessary, initialize experiment and fire the A/B test enrollment hook.
	const stickyHeaderExperiment =
		!!ABTestConfig.enabled &&
		ABTestConfig.name === stickyHeader.STICKY_HEADER_EXPERIMENT_NAME &&
		!mw.user.isAnon() &&
		stickyHeader.isStickyHeaderAllowed() &&
		initExperiment( Object.assign( {}, ABTestConfig, { token: mw.user.getId() } ) );

	// Remove class if present on the html element so that scroll padding isn't undesirably
	// applied to users who don't experience the new treatment.
	if ( stickyHeaderExperiment && !stickyHeaderExperiment.isInTreatmentBucket() ) {
		document.documentElement.classList.remove( 'vector-sticky-header-enabled' );
	}

	const
		targetElement = stickyHeader.header,
		targetIntersection = stickyHeader.stickyIntersection,
		isStickyHeaderAllowed = stickyHeaderExperiment ?
			stickyHeaderExperiment.isInTreatmentBucket() : stickyHeader.isStickyHeaderAllowed();

	// Set up intersection observer for sticky header functionality and firing scroll event hooks
	// for event logging if AB test is enabled.
	const observer = scrollObserver.initScrollObserver(
		() => {
			if ( targetElement && isStickyHeaderAllowed ) {
				stickyHeader.show();
			}
			scrollObserver.fireScrollHook( 'down' );
		},
		() => {
			if ( targetElement && isStickyHeaderAllowed ) {
				stickyHeader.hide();
			}
			scrollObserver.fireScrollHook( 'up' );
		}

	);

	if ( isStickyHeaderAllowed ) {
		stickyHeader.initStickyHeader( observer );
	} else if ( targetIntersection ) {
		observer.observe( targetIntersection );
	}

	// Table of contents
	const tocElement = document.getElementById( TOC_ID );
	const legacyTOCElement = document.getElementById( LEGACY_TOC_ID );
	const bodyContent = document.getElementById( BODY_CONTENT_ID );

	// Add event data attributes to legacy TOC
	if ( legacyTOCElement ) {
		legacyTOCElement.setAttribute( 'data-event-name', 'ui.toc' );
	}

	if ( !(
		tocElement &&
		bodyContent &&
		window.IntersectionObserver &&
		window.requestAnimationFrame )
	) {
		return;
	}

	const tableOfContents = initTableOfContents( {
		container: tocElement,
		onHeadingClick: ( id ) => {

			// eslint-disable-next-line no-use-before-define
			sectionObserver.pause();

			tableOfContents.expandSection( id );
			tableOfContents.changeActiveSection( id );

			// T297614: We want the link that the user has clicked inside the TOC to
			// be "active" (e.g. bolded) regardless of whether the browser's scroll
			// position corresponds to that section. Therefore, we need to temporarily
			// ignore section observer until the browser has finished scrolling to the
			// section (if needed).
			//
			// However, because the scroll event happens asyncronously after the user
			// clicks on a link and may not even happen at all (e.g. the user has
			// scrolled all the way to the bottom and clicks a section that is already
			// in the viewport), determining when we should resume section observer is
			// a bit tricky.
			//
			// Because a scroll event may not even be triggered after clicking the
			// link, we instead allow the browser to perform a maximum number of
			// repaints before resuming sectionObserver. Per T297614#7687656, Firefox
			// 97.0 wasn't consistently activating the table of contents section that
			// the user clicked even after waiting 2 frames. After further
			// investigation, it sometimes waits up to 3 frames before painting the
			// new scroll position so we have that as the limit.
			//
			// eslint-disable-next-line no-use-before-define
			deferUntilFrame( () => sectionObserver.resume(), 3 );
		},
		onToggleClick: ( id ) => {
			tableOfContents.toggleExpandSection( id );
		}
	} );
	const sectionObserver = initSectionObserver( {
		elements: bodyContent.querySelectorAll( 'h1, h2, h3, h4, h5, h6' ),
		topMargin: targetElement ? targetElement.getBoundingClientRect().height : 0,
		onIntersection: ( section ) => {
			const headline = section.querySelector( HEADLINE_SELECTOR );

			if ( headline ) {
				tableOfContents.changeActiveSection( TOC_SECTION_ID_PREFIX + headline.id );
			}
		}
	} );
};

module.exports = {
	main: main
};
