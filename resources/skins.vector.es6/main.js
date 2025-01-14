// Enable Vector features limited to ES6 browse
const
	searchToggle = require( './searchToggle.js' ),
	stickyHeader = require( './stickyHeader.js' ),
	scrollObserver = require( './scrollObserver.js' ),
	initExperiment = require( './AB.js' ),
	initSectionObserver = require( './sectionObserver.js' ),
	initTableOfContents = require( './tableOfContents.js' ),
	deferUntilFrame = require( './deferUntilFrame.js' ),
	ABTestConfig = require( /** @type {string} */ ( './config.json' ) ).wgVectorWebABTestEnrollment || {},
	TOC_ID = 'mw-panel-toc',
	TOC_ID_LEGACY = 'toc',
	BODY_CONTENT_ID = 'bodyContent',
	HEADLINE_SELECTOR = '.mw-headline',
	TOC_SECTION_ID_PREFIX = 'toc-',
	TOC_LEGACY_PLACEHOLDER_TAG = 'mw:tocplace',
	TOC_SCROLL_HOOK = 'table_of_contents',
	PAGE_TITLE_SCROLL_HOOK = 'page_title',
	PAGE_TITLE_INTERSECTION_CLASS = 'vector-below-page-title',
	TOC_EXPERIMENT_NAME = 'skin-vector-toc-experiment';

/**
 * @callback OnIntersection
 * @param {HTMLElement} element The section that triggered the new intersection change.
 */

/**
 * @ignore
 * @param {Function} changeActiveSection
 * @return {OnIntersection}
 */
const getHeadingIntersectionHandler = ( changeActiveSection ) => {
	/**
	 * @param {HTMLElement} section
	 */
	return ( section ) => {
		const headline = section.classList.contains( 'mw-body-content' ) ?
			section :
			section.querySelector( HEADLINE_SELECTOR );
		if ( headline ) {
			changeActiveSection( `${TOC_SECTION_ID_PREFIX}${headline.id}` );
		}
	};
};

/**
 * Initialize sticky header AB tests and determine whether to show the sticky header
 * based on which buckets the user is in.
 *
 * @typedef {Object} InitStickyHeaderABTests
 * @property {boolean} disableEditIcons - Should the sticky header have an edit icon
 * @property {boolean} showStickyHeader - Should the sticky header be shown
 * @param {ABTestConfig} abConfig
 * @param {boolean} isStickyHeaderFeatureAllowed and the user is logged in
 * @param {function(ABTestConfig): initExperiment.WebABTest} getEnabledExperiment
 * @return {InitStickyHeaderABTests}
 */
function initStickyHeaderABTests( abConfig, isStickyHeaderFeatureAllowed, getEnabledExperiment ) {
	let show = isStickyHeaderFeatureAllowed,
		stickyHeaderExperiment,
		noEditIcons = true;

	// One of the sticky header AB tests is specified in the config
	const abTestName = abConfig.name,
		isStickyHeaderExperiment = abTestName === stickyHeader.STICKY_HEADER_EXPERIMENT_NAME ||
			abTestName === stickyHeader.STICKY_HEADER_EDIT_EXPERIMENT_NAME;

	// Determine if user is eligible for sticky header AB test
	if (
		isStickyHeaderFeatureAllowed && // The sticky header can be shown on the page
		abConfig.enabled && // An AB test config is enabled
		isStickyHeaderExperiment // The AB test is one of the sticky header experiments
	) {
		// If eligible, initialize the AB test
		stickyHeaderExperiment = getEnabledExperiment( abConfig );

		// If running initial AB test, only show sticky header to treatment group.
		if ( abTestName === stickyHeader.STICKY_HEADER_EXPERIMENT_NAME ) {
			show = stickyHeaderExperiment.isInTreatmentBucket();
		}

		// If running edit-button AB test, show sticky header to all buckets
		// and show edit button for treatment group
		if ( abTestName === stickyHeader.STICKY_HEADER_EDIT_EXPERIMENT_NAME ) {
			show = true;
			if ( stickyHeaderExperiment.isInTreatmentBucket() ) {
				noEditIcons = false;
			}
		}
	} else if (
		// T310750 Account for when the current experiment is not sticky header or it's disabled.
		isStickyHeaderFeatureAllowed && ( !abConfig.enabled || !isStickyHeaderExperiment )
	) {
		noEditIcons = false;
	}

	return {
		showStickyHeader: show,
		disableEditIcons: noEditIcons
	};
}

/**
 * @return {void}
 */
const main = () => {
	// Initialize the search toggle for the main header only. The sticky header
	// toggle is initialized after Codex search loads.
	const searchToggleElement = document.querySelector( '.mw-header .search-toggle' );
	if ( searchToggleElement ) {
		searchToggle( searchToggleElement );
	}

	// Sticky header
	const
		header = document.getElementById( stickyHeader.STICKY_HEADER_ID ),
		stickyIntersection = document.getElementById( stickyHeader.FIRST_HEADING_ID ),
		userMenu = document.getElementById( stickyHeader.USER_MENU_ID ),
		allowedNamespace = stickyHeader.isAllowedNamespace( mw.config.get( 'wgNamespaceNumber' ) ),
		allowedAction = stickyHeader.isAllowedAction( mw.config.get( 'wgAction' ) );

	const isStickyHeaderAllowed =
		!!header &&
		!!stickyIntersection &&
		!!userMenu &&
		allowedNamespace &&
		allowedAction &&
		'IntersectionObserver' in window;

	const { showStickyHeader, disableEditIcons } = initStickyHeaderABTests(
		ABTestConfig,
		isStickyHeaderAllowed && !mw.user.isAnon(),
		( config ) => initExperiment(
			Object.assign( {}, config, { token: mw.user.getId() } )
		)
	);

	// Set up intersection observer for page title, used by sticky header
	const observer = scrollObserver.initScrollObserver(
		() => {
			if ( isStickyHeaderAllowed && showStickyHeader ) {
				stickyHeader.show();
			}
			scrollObserver.fireScrollHook( 'down', PAGE_TITLE_SCROLL_HOOK );
		},
		() => {
			if ( isStickyHeaderAllowed && showStickyHeader ) {
				stickyHeader.hide();
			}
			scrollObserver.fireScrollHook( 'up', PAGE_TITLE_SCROLL_HOOK );
		}
	);

	if ( !showStickyHeader ) {
		stickyHeader.hide();
	}

	if ( isStickyHeaderAllowed && showStickyHeader ) {
		stickyHeader.initStickyHeader( {
			header,
			userMenu,
			observer,
			stickyIntersection,
			disableEditIcons
		} );
	} else if ( stickyIntersection ) {
		observer.observe( stickyIntersection );
	}

	// Table of contents
	const tocElement = document.getElementById( TOC_ID );
	const tocElementLegacy = document.getElementById( TOC_ID_LEGACY );
	const bodyContent = document.getElementById( BODY_CONTENT_ID );

	// Setup intersection observer for TOC scroll event tracking
	// fire hooks for event logging if AB tests are enabled
	const tocLegacyPlaceholder = document.getElementsByTagName( TOC_LEGACY_PLACEHOLDER_TAG )[ 0 ];
	const tocLegacyTargetIntersection = tocElementLegacy || tocLegacyPlaceholder;
	// Initiate observer for table of contents in main content.
	if ( tocLegacyTargetIntersection ) {
		const tocObserver = scrollObserver.initScrollObserver(
			() => {
				scrollObserver.fireScrollHook( 'down', TOC_SCROLL_HOOK );
			},
			() => {
				scrollObserver.fireScrollHook( 'up', TOC_SCROLL_HOOK );
			}
		);
		tocObserver.observe( tocLegacyTargetIntersection );
	}

	// Add event data attributes to legacy TOC
	if ( tocElementLegacy ) {
		tocElementLegacy.setAttribute( 'data-event-name', 'ui.toc' );
	}

	if ( !(
		tocElement &&
		bodyContent &&
		window.IntersectionObserver &&
		window.requestAnimationFrame
	) ) {
		return;
	}

	const experiment =
		!!ABTestConfig.enabled &&
		ABTestConfig.name === TOC_EXPERIMENT_NAME &&
		document.body.classList.contains( ABTestConfig.name ) &&
		// eslint-disable-next-line compat/compat
		window.URLSearchParams &&
		initExperiment( ABTestConfig );
	const isInTreatmentBucket = !!experiment && experiment.isInTreatmentBucket();

	if ( experiment && !isInTreatmentBucket ) {
		// Return early if the old TOC is shown.
		return;
	}

	// T307900 Setup observer for collapsible TOC
	if ( stickyIntersection ) {
		scrollObserver.initScrollObserver(
			() => {
				document.body.classList.add( PAGE_TITLE_INTERSECTION_CLASS );
			},
			() => {
				document.body.classList.remove( PAGE_TITLE_INTERSECTION_CLASS );
			}
		).observe( stickyIntersection );
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
	const headingSelector = [
		'h1', 'h2', 'h3', 'h4', 'h5', 'h6'
	].map( ( tag ) => `.mw-parser-output > ${tag}` ).join( ',' );
	const sectionObserver = initSectionObserver( {
		elements: bodyContent.querySelectorAll( `${headingSelector}, .mw-body-content` ),
		topMargin: header ? header.getBoundingClientRect().height : 0,
		onIntersection: getHeadingIntersectionHandler( tableOfContents.changeActiveSection )
	} );
};

module.exports = {
	main,
	test: {
		initStickyHeaderABTests,
		getHeadingIntersectionHandler
	}
};
