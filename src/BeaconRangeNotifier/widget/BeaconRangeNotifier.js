/*jslint browser:true, nomen:true, plusplus: true */
/*global mx, mendix, require, console, device, EstimoteBeacons, define, module, logger, cordova */
define([
    "dojo/_base/declare",
    "mxui/widget/_WidgetBase",
    "dojo/_base/lang"
], function (declare, _WidgetBase, lang) {
    "use strict";

    return declare("BeaconRangeNotifier.widget.BeaconRangeNotifier", [ _WidgetBase ], {

        // Set in Modeler
        beaconJsonAttr: "",
        beaconDataReceivedMF: "",
        scanInterval: 60000,
        endPoint: "beacons",

        // Internal values
        _domain: "ITvisors",     // Stub value, isn't actually relevant, but needed for estimote
        _endPointUrl: null,

        _ranging: false,
        _pauseID: null,
        _resumeID: null,

        postCreate: function () {
            logger.debug(this.id + ".postCreate");

            if (!window.cordova || !window.estimote || !window.EstimoteBeacons) {
                logger.warn(this.id + ".postCreate: not in Phonegap, so BeaconRangeNotifier is disabled");
                return;
            }

            if (!this.beaconSet) {
                logger.warn(this.id + ".postCreate: no beacons configured");
                return;
            }

            this._endPointUrl = mx.remoteUrl + this.endPoint;

            if (device.platform === "Android") {
                var permissions = window.plugins.permissions;
                if (permissions) {
                    permissions.requestPermission(function () {
                        logger.debug("ACCESS_FINE_LOCATION permission accepted");
                        this.addBeaconMonitor();
                        setTimeout(lang.hitch(this, this.addBeaconScanner), 15000); // Timeout adding the scanner because we already added a monitor
                    }.bind(this), function (e) {
                        console.error("Error requesting Error FINE_LOCATION", e);
                    }, permissions.ACCESS_FINE_LOCATION);
                } else {
                    this.addBeaconMonitor();
                    setTimeout(lang.hitch(this, this.addBeaconScanner), 15000); // Timeout adding the scanner because we already added a monitor
                }
            } else {
                this.addBeaconMonitor();
                setTimeout(lang.hitch(this, this.addBeaconScanner), 15000); // Timeout adding the scanner because we already added a monitor
            }
        },

        _onBeaconsReceived: function (e) {
            var timestamp = +(new Date());
            if (e && e.beacons && e.beacons.length) {
                window.backgroundScanBeacons = {
                    timestamp : timestamp,
                    beacons : e.beacons
                };
            } else {
                window.backgroundScanBeacons = {
                    timestamp : timestamp,
                    beacons: []
                };
            }
        },

        _onBeaconsReceivedInMonitoring: function (e) {
            var b,
                beacon,
                cachedBeacon,
                found,
                m,
                timestamp = +(new Date());

            if (!window.monitoringScanBeacons) {
                window.monitoringScanBeacons = {
                    beacons: []
                };
            }
            window.monitoringScanBeacons.timestamp = timestamp;

            if (e && e.beacons && e.beacons.length) {
                for (b = 0; b < e.beacons.length; b++) {
                    found = false;
                    beacon = e.beacons[b];
                    for (m = 0; m < window.monitoringScanBeacons.beacons.length; m++) {
                        cachedBeacon = window.monitoringScanBeacons.beacons[m];
                        if (cachedBeacon.minor === beacon.minor && cachedBeacon.major === beacon.major) {
                            found = true;
                            cachedBeacon.distance = (beacon.distance < cachedBeacon.distance) ? beacon.distance : cachedBeacon.distance;
                        }
                    }
                    if (!found) {
                        window.monitoringScanBeacons.beacons.push(beacon);
                    }
                }
            }
        },

//        _sendBeacon: function (info) {
//            if (!this._endPointUrl || !info) {
//                return;
//            }
//
//            logger.debug(this.id + "._sendBeacon: " + JSON.stringify(info));
//            var beaconId = info.major + "_" + info.minor,
//                url = this._endPointUrl + "?deviceId=" + info.device + "&beaconId=" + beaconId + "&distance=" + info.distance,
//                request = new XMLHttpRequest();
//
//            request.open("GET", url);
//
//            request.addEventListener("load", lang.hitch(this, function () {
//                logger.debug(this.id + "._sendBeacon " + beaconId + " complete");
//            }));
//            request.addEventListener("error", lang.hitch(this, function () {
//                logger.debug(this.id + "._sendBeacon " + beaconId + " error");
//            }));
//
//            request.send();
//        },

        _sendBeacons: function (monitor) {
            logger.debug(this.id + "._sendBeacons from " + (monitor ? "monitor" : "ranging"));

            var beaconData,
                timestamp = +(new Date()),
                scannedBeacons = monitor ? window.monitoringScanBeacons : window.backgroundScanBeacons;

            if (scannedBeacons && scannedBeacons.beacons.length && (timestamp - scannedBeacons.timestamp < 15000)) { // Only send this if it is not more than 15 seconds old
                beaconData = JSON.stringify(scannedBeacons);
                this.mxcontext.getTrackObject().set(this.beaconJsonAttr, beaconData);
                mx.data.action({
                    params       : {
                        applyto     : "selection",
                        actionname  : this.beaconDataReceivedMF,
                        guids       : [this.mxcontext.getTrackId()]
                    },
                    callback     : lang.hitch(this, this._getConfigurationCallback),
                    error        : lang.hitch(this, this._errorCallback),
                    onValidation : lang.hitch(this, this._errorCallback)
                });

                if (monitor) {
                    window.monitoringScanBeacons.beacons = [];
                }

            } else {
                logger.debug(this.id + "._sendBeacons no beacons found, not sending any");
            }
        },
        
        _errorCallback: function (error) {
            console.error(this.id + "._errorCallback called");
            console.dir(error);
        },

        rangeAndReport: function () {
            logger.debug(this.id + ".rangeAndReport: " + !this._ranging);
            if (this._ranging) {
                return;
            }

            this._ranging = true;

            var region = {};

            setTimeout(lang.hitch(this, function () {
                logger.debug(this.id + ".rangeAndReport stop ranging");
                EstimoteBeacons.stopRangingBeaconsInRegion({});
                this._sendBeacons(true); // We are sending the monitored beacons, not from ranging
                this._ranging = false;
            }), 5000); // range for 7 seconds, kill ranging and

            EstimoteBeacons.startRangingBeaconsInRegion(
                {},
                lang.hitch(this, this._onBeaconsReceivedInMonitoring),
                lang.hitch(this, this.onError)
            );
        },

        onMonitor: function (regionState) {
            logger.debug(this.id + ".onMonitor: " + JSON.stringify(regionState));
            this.rangeAndReport();
        },

        onError: function (errorMessage) {
            logger.debug(this.id + ".onError");
            console.log(errorMessage);
        },

        /**
        * Start beacon monitoring for the specified beacons.
        */
        addBeaconMonitor: function () {
            logger.debug(this.id + ".addBeaconMonitor");

            // Request authorisation.
            EstimoteBeacons.requestAlwaysAuthorization();

            var i = 0;

            this.beaconSet.forEach(lang.hitch(this, function (beacon) {
                var monitor = EstimoteBeacons.startMonitoringForRegion(
                    {
                        identifier: "region" + i,
                        uuid: beacon.beaconUUID,
                        minor: beacon.beaconMinor,
                        major: beacon.beaconMajor
                    },
                    lang.hitch(this, this.onMonitor),
                    lang.hitch(this, this.onError)
                );

                logger.debug(this.id + ".addBeaconMonitor region" + i + " result = " + monitor + " for " + beacon.beaconUUID + ":" + beacon.beaconMajor + ":" + beacon.beaconMinor);
                i++;
            }));

            // EstimoteBeacons.startMonitoringForRegion(
            //     {},
            //     lang.hitch(this, this.onMonitor),
            //     lang.hitch(this, this.onError)
            // );
        },

        /**
        * Start beacon monitoring for the specified beacons.
        */
        addBeaconScanner: function () {
            logger.debug(this.id + ".addBeaconScanner");
            this._ranging = true;

            if (this._pauseID === null) {
                this._pauseID = this.id;
                document.addEventListener("pause", lang.hitch(this, function () {
                    logger.debug(this.id + ".beaconScanner document pause");
                    EstimoteBeacons.stopRangingBeaconsInRegion({});
                    clearInterval(window.scannerID);
                    this._ranging = false;
                }), false);
            }

            if (this._resumeID === null) {
                this._resumeID = this.id;
                document.addEventListener("resume", lang.hitch(this, function () {
                    logger.debug(this.id + ".beaconScanner document resume");
                    this.addBeaconScanner();
                }), false);
            }

            EstimoteBeacons.startRangingBeaconsInRegion(
                {},
                lang.hitch(this, this._onBeaconsReceived),
                lang.hitch(this, this.onError)
            );

            setTimeout(lang.hitch(this, this._sendBeacons), 5000); // Send first one after five seconds so it has already started ranging

            if (window.scannerID) {
                clearInterval(window.scannerID);
                window.scannerID = null;
            }

            window.scannerID = setInterval(lang.hitch(this, this._sendBeacons), this.scanInterval);
        },

        resize: function (box) {}, // stub, sometimes a widget will fail if it has no resize method

        uninitialize: function () {
            logger.debug(this.id + ".uninitialize");
            var i = 0;
            if (window.EstimoteBeacons) {
                this.beaconSet.forEach(lang.hitch(this, function (beacon) {
                    var monitor = EstimoteBeacons.stopMonitoringForRegion(
                        {
                            identifier: "region" + i,
                            uuid: beacon.uuid,
                            minor: beacon.minor,
                            major: beacon.major
                        }
                    );

                    logger.debug(this.id + ".stopBeaconMonitor region" + i + " result = " + monitor + " for " + beacon.uuid + ":" + beacon.major + ":" + beacon.minor);
                    i++;
                }));

                EstimoteBeacons.stopRangingBeaconsInRegion({});

                window.backgroundScanBeacons = null;
                window.monitoringScanBeacons = null;

                if (window.scannerID) {
                    clearInterval(window.scannerID);
                    window.scannerID = null;
                }
            }
        }
    });
});

require(["BeaconRangeNotifier/widget/BeaconRangeNotifier"]);
