import React from 'react';
import {withOnyx} from 'react-native-onyx';
import PropTypes from 'prop-types';
import {Keyboard, View} from 'react-native';
import lodashGet from 'lodash/get';
import _ from 'underscore';
import lodashFindLast from 'lodash/findLast';
import DrawerStatusContext from '@react-navigation/drawer/lib/module/utils/DrawerStatusContext';
import styles from '../../styles/styles';
import ScreenWrapper from '../../components/ScreenWrapper';
import HeaderView from './HeaderView';
import Navigation from '../../libs/Navigation/Navigation';
import ROUTES from '../../ROUTES';
import * as Report from '../../libs/actions/Report';
import ONYXKEYS from '../../ONYXKEYS';
import Permissions from '../../libs/Permissions';
import * as ReportUtils from '../../libs/ReportUtils';
import ReportActionsView from './report/ReportActionsView';
import ReportActionCompose from './report/ReportActionCompose';
import SwipeableView from '../../components/SwipeableView';
import CONST from '../../CONST';
import ReportActionsSkeletonView from '../../components/ReportActionsSkeletonView';
import reportActionPropTypes from './report/reportActionPropTypes';
import ArchivedReportFooter from '../../components/ArchivedReportFooter';
import toggleReportActionComposeView from '../../libs/toggleReportActionComposeView';
import compose from '../../libs/compose';
import withWindowDimensions, {windowDimensionsPropTypes} from '../../components/withWindowDimensions';

const propTypes = {
    /** Navigation route context info provided by react navigation */
    route: PropTypes.shape({
        /** Route specific parameters used on this screen */
        params: PropTypes.shape({
            /** The ID of the report this screen should display */
            reportID: PropTypes.string,
        }).isRequired,
    }).isRequired,

    /** Tells us if the sidebar has rendered */
    isSidebarLoaded: PropTypes.bool,

    /** Whether or not to show the Compose Input */
    session: PropTypes.shape({
        shouldShowComposeInput: PropTypes.bool,
    }),

    /** The report currently being looked at */
    report: PropTypes.shape({
        /** Number of actions unread */
        unreadActionCount: PropTypes.number,

        /** The largest sequenceNumber on this report */
        maxSequenceNumber: PropTypes.number,

        /** The current position of the new marker */
        newMarkerSequenceNumber: PropTypes.number,

        /** Whether there is an outstanding amount in IOU */
        hasOutstandingIOU: PropTypes.bool,
    }),

    /** Array of report actions for this report */
    reportActions: PropTypes.objectOf(PropTypes.shape(reportActionPropTypes)),

    /** Are we waiting for more report data? */
    isLoadingReportData: PropTypes.bool,

    /** Whether the composer is full size */
    isComposerFullSize: PropTypes.bool,

    /** Beta features list */
    betas: PropTypes.arrayOf(PropTypes.string),

    /** Flag to check if the report actions data are loading */
    isLoadingReportActions: PropTypes.bool,

    /** The policies which the user has access to */
    policies: PropTypes.objectOf(PropTypes.shape({
        /** The policy name */
        name: PropTypes.string,

        /** The type of the policy */
        type: PropTypes.string,
    })).isRequired,

    ...windowDimensionsPropTypes,
};

const defaultProps = {
    isSidebarLoaded: false,
    session: {
        shouldShowComposeInput: true,
    },
    reportActions: {},
    report: {
        unreadActionCount: 0,
        maxSequenceNumber: 0,
        hasOutstandingIOU: false,
    },
    isLoadingReportData: false,
    isComposerFullSize: false,
    betas: [],
    isLoadingReportActions: false,
};

/**
 * Get the currently viewed report ID as number
 *
 * @param {Object} route
 * @param {Object} route.params
 * @param {String} route.params.reportID
 * @returns {Number}
 */
function getReportID(route) {
    const params = route.params;
    return Number.parseInt(params.reportID, 10);
}

class ReportScreen extends React.Component {
    constructor(props) {
        super(props);

        this.onSubmitComment = this.onSubmitComment.bind(this);
        this.updateViewportOffsetTop = this.updateViewportOffsetTop.bind(this);
        this.removeViewportResizeListener = () => {};

        this.state = {
            viewportOffsetTop: 0,
        };
    }

    componentDidMount() {
        this.storeCurrentlyViewedReport();
        this.removeViewportResizeListener = addViewportResizeListener(this.updateViewportOffsetTop);
    }

    componentDidUpdate(prevProps) {
        if (this.props.route.params.reportID === prevProps.route.params.reportID) {
            return;
        }

        this.storeCurrentlyViewedReport();
    }

    componentWillUnmount() {
        if (!window.visualViewport) {
            return;
        }
        window.visualViewport.removeEventListener('resize', this.viewportOffsetTop);
    }

    /**
     * @param {String} text
     */
    onSubmitComment(text) {
        Report.addComment(getReportID(this.props.route), text);
    }

    setChatFooterStyles(isOffline) {
        return {...styles.chatFooter, minHeight: !isOffline ? CONST.CHAT_FOOTER_MIN_HEIGHT : 0};
    }

    /**
     * When reports change there's a brief time content is not ready to be displayed
     *
     * @returns {Boolean}
     */
    shouldShowLoader() {
        const isLoadingInitialReportActions = _.isEmpty(this.props.reportActions) && this.props.isLoadingReportActions;
        return !getReportID(this.props.route) || isLoadingInitialReportActions;
    }

    /**
     * Persists the currently viewed report id
     */
    storeCurrentlyViewedReport() {
        const reportID = getReportID(this.props.route);
        if (_.isNaN(reportID)) {
            Report.handleInaccessibleReport();
            return;
        }

        // Always reset the state of the composer view when the current reportID changes
        toggleReportActionComposeView(true);
        Report.updateCurrentlyViewedReportID(reportID);
    }

    /**
     * @param {SyntheticEvent} e
     */
    updateViewportOffsetTop(e) {
        const viewportOffsetTop = lodashGet(e, 'target.offsetTop', 0);
        this.setState({viewportOffsetTop});
    }

    render() {
        if (!this.props.isSidebarLoaded) {
            return null;
        }

        if (this.props.isSmallScreenWidth && this.context === 'open') {
            return null;
        }

        // We let Free Plan default rooms to be shown in the App - it's the one exception to the beta, otherwise do not show policy rooms in product
        if (!Permissions.canUseDefaultRooms(this.props.betas)
            && ReportUtils.isDefaultRoom(this.props.report)
            && ReportUtils.getPolicyType(this.props.report, this.props.policies) !== CONST.POLICY.TYPE.FREE) {
            return null;
        }

        if (!Permissions.canUsePolicyRooms(this.props.betas) && ReportUtils.isUserCreatedPolicyRoom(this.props.report)) {
            return null;
        }

        const reportID = getReportID(this.props.route);

        const isArchivedRoom = ReportUtils.isArchivedRoom(this.props.report);
        let reportClosedAction;
        if (isArchivedRoom) {
            reportClosedAction = lodashFindLast(this.props.reportActions, action => action.actionName === CONST.REPORT.ACTIONS.TYPE.CLOSED);
        }
        return (
            <ScreenWrapper style={[styles.appContent, styles.flex1, {marginTop: this.state.viewportOffsetTop}]}>
                <HeaderView
                    reportID={reportID}
                    onNavigationMenuButtonClicked={() => Navigation.navigate(ROUTES.HOME)}
                />

                <View
                    nativeID={CONST.REPORT.DROP_NATIVE_ID}
                    style={[styles.flex1, styles.justifyContentEnd, styles.overflowHidden]}
                >
                    {this.shouldShowLoader() && <FullScreenLoadingIndicator />}
                    {!this.shouldShowLoader() && (
                        <ReportActionsView
                            reportID={reportID}
                            reportActions={this.props.reportActions}
                            report={this.props.report}
                            session={this.props.session}
                            isComposerFullSize={this.props.isComposerFullSize}
                        />
                    )}
                    {(isArchivedRoom || this.props.session.shouldShowComposeInput) && (
                        <View style={[this.setChatFooterStyles(this.props.network.isOffline), this.props.isComposerFullSize && styles.chatFooterFullCompose]}>
                            {
                                isArchivedRoom
                                    ? (
                                        <ArchivedReportFooter
                                            reportClosedAction={reportClosedAction}
                                            report={this.props.report}
                                            isComposerFullSize={this.props.isComposerFullSize}
                                        />
                                    </SwipeableView>
                                )
                        }
                    </View>
                    )}
                </View>
            </ScreenWrapper>
        );
    }
}

ReportScreen.contextType = DrawerStatusContext;
ReportScreen.propTypes = propTypes;
ReportScreen.defaultProps = defaultProps;

export default withOnyx({
    isSidebarLoaded: {
        key: ONYXKEYS.IS_SIDEBAR_LOADED,
    },
    session: {
        key: ONYXKEYS.SESSION,
    },
    reportActions: {
        key: ({route}) => `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${getReportID(route)}`,
        canEvict: false,
    },
    report: {
        key: ({route}) => `${ONYXKEYS.COLLECTION.REPORT}${getReportID(route)}`,
    },
    isLoadingReportData: {
        key: ONYXKEYS.IS_LOADING_REPORT_DATA,
    },
    isComposerFullSize: {
        key: ({route}) => `${ONYXKEYS.COLLECTION.REPORT_IS_COMPOSER_FULL_SIZE}${getReportID(route)}`,
    },
    betas: {
        key: ONYXKEYS.BETAS,
    },
    isLoadingReportActions: {
        key: ({route}) => `${ONYXKEYS.COLLECTION.IS_LOADING_REPORT_ACTIONS}${getReportID(route)}`,
        initWithStoredValues: false,
    },
    policies: {
        key: ONYXKEYS.COLLECTION.POLICY,
    },
})(ReportScreen);
