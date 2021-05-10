const fs = require("fs");
const { execFile, exec } = require("child_process");
const path = require("path");
const NtpTimeSync = require("ntp-time-sync");
const url = require('url');

//Latest VLC module version
const LATEST_MODULE_VER = 200;

//Local anime folder and VLC exe path vars
var VLC_EXE = window.localStorage.vlcExePath || 'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe';

//VLC processes and sync vars
var vlcProcess, vlcIsOpen, forceVLCSkip = false,
    flags = { //The flags object provides cloud-updatable parameters that can be used to fine-tune red. The values below are the default/fallback as of this version.
        allowedOffset: 1, //How far off (+/-) from where playback should be, in seconds, before re-syncing it
        lowLatencyOffset: 0.5, //A lower version of allowedOffset to keep playback closer to where it should be. May cause more skipping.
        allowedHostOffset: 1, //How far out of sync the video needs to be for it to be considered deliberate seeking by the host
        offsetLimit: 50, //How many times the time offset will be ran (not applicable to ntp mode)
        seekFudge: 0.1, //When syncing playback from host, this amount will be added to compensate for delays between getting data from VLC and writing to firebase
        timeSyncMethod: "ntp" //How the clock should be synchronized (either "ntp" for new fancy mode or "backend" for old server mode)
    };

//HTTP request auth and configuration
$.ajaxSetup({
    timeout: 1000, beforeSend: function (xhr) {
        xhr.setRequestHeader("Authorization", "Basic " + btoa(":anime"));
    }
});

//Flags
firebase.database().ref("/flags").on('value', snap => {
    var data = snap.val();
    if (data) {
        Object.assign(flags, data);
    }
})

//SET VLC STATE ----------------------
var failCount = 0, videoFail = 0, startAt = new Date();
setInterval(function () {
    if (vlcIsOpen) { //Only make web requests when VLC is open
        let preReq = new Date().getTime();
        jQuery.getJSON("http://localhost:7019/requests/jottocraft.json", function (data) {
            if (data.length) {
                $("#sessionStatusBar .videoDuration").text(minutesAndSeconds(data.length * 1000));
                $("#sessionStatusBar .videoDuration").parent().show();
            } else {
                $("#sessionStatusBar .videoDuration").parent().hide();
            }

            if (vlcPlaybackState.host) {
                //HOST
                syncHostPlayback(data, preReq);
            } else {
                //CLIENT
                setClientPlayback(data, preReq);
            }
        });
    }
}, 500);

function setClientPlayback(data, preReqTime) {
    var allowedOffset = ((fluid.get("pref-lowLatency") == "true") ? flags.lowLatencyOffset : flags.allowedOffset) * vlcPlaybackState.rate;

    if (vlcPlaybackState.video && file) {
        //SYNC VIDEO STATE
        if (videoFail >= 10) {
            window.alert("Red cannot open your video file in VLC. This probably means that the video you downloaded is corrupted.");
            window.close();
        }

        //Open video in VLC if it's not already open
        if (data?.metas?.filename) {
            if (!file.endsWith(data?.metas?.filename)) {
                jQuery.get("http://localhost:7019/requests/jottocraft.json?command=playitem&input=" + file.replace("/", "\\"));
                videoFail++;
            } else {
                videoFail = 0;
            }
        } else {
            jQuery.get("http://localhost:7019/requests/jottocraft.json?command=playitem&input=" + file.replace("/", "\\"));
            videoFail++;
        }

        //SYNC PLAYBACK SPEED STATE
        if (vlcPlaybackState.rate && (data.rate !== vlcPlaybackState.rate)) {
            jQuery.get("http://localhost:7019/requests/jottocraft.json?command=rate&val=" + vlcPlaybackState.rate);
        }

        //SYNC PLAY/PAUSE STATE
        if (vlcPlaybackState.state.startsWith("play|")) {
            //Calculate expected time, update VLC time if it is off by more than the allowed offset
            let calculatedTime = (((getServerTime().getTime() - Number(vlcPlaybackState.state.split("|")[2])) / 1000) * vlcPlaybackState.rate) + Number(vlcPlaybackState.state.split("|")[1]);

            if (calculatedTime <= data.length) {
                if (data.state == "paused") jQuery.get("http://localhost:7019/requests/jottocraft.json?command=play");

                let adjustedTime = data.time + ((new Date().getTime() - preReqTime) / 1000);
                $("#syncOffset").text(Math.round((adjustedTime - calculatedTime) * 1000));
                if (forceVLCSkip || (Math.abs(adjustedTime - calculatedTime) > allowedOffset)) {
                    jQuery.get("http://localhost:7019/requests/jottocraft.json?command=playerseek&val=" + Number(calculatedTime + flags.seekFudge).toFixed(6));
                    forceVLCSkip = false; //reset force vlc skip flag after syncing
                }
            }
        } else if (vlcPlaybackState.state.startsWith("pause|")) {
            //Seek and pause
            if (data.state == "playing") jQuery.get("http://localhost:7019/requests/jottocraft.json?command=pause");
            jQuery.get("http://localhost:7019/requests/jottocraft.json?command=playerseek&val=" + Number(vlcPlaybackState.state.split("|")[1]).toFixed(6));
        }

        //SYNC TRACK STATE
        if ((fluid.get("pref-trackSync") !== "false") && data.tracks) {
            //For each track type, check if the correct track is selected, if not, select the correct track
            ["spu", "audio", "video"].forEach(trackType => {
                if (data.tracks[trackType]) {
                    var activeTrack = data.tracks[trackType].find(t => t.selected); //find item in tracks array that is selected
                    if (!vlcPlaybackState[trackType + "Track"] && activeTrack) {
                        //Disable selected track (no tracks of this type should be selected)
                        jQuery.get("http://localhost:7019/requests/jottocraft.json?command=" + trackType + "_track&val=" + activeTrack.id);
                    } else if ((activeTrack && activeTrack.id) !== vlcPlaybackState[trackType + "Track"]) {
                        //Switch track (incorrect or no track selected)
                        jQuery.get("http://localhost:7019/requests/jottocraft.json?command=" + trackType + "_track&val=" + vlcPlaybackState[trackType + "Track"]);
                    }
                }
            });
        }
    } else {
        jQuery.get("http://localhost:7019/requests/jottocraft.json?command=stop");
    }
}

function syncHostPlayback(data, preReqTime) {
    var allowedOffset = flags.allowedHostOffset * data.rate;

    //SET VIDEO FILE STATE
    if (data?.metas?.filename && (vlcPlaybackState.video !== data?.metas?.filename)) {
        firebase.database().ref("/session/" + mySessionID + "/status/video").set(data?.metas?.filename);
    } else if (!data?.metas?.filename && vlcPlaybackState.video) {
        firebase.database().ref("/session/" + mySessionID + "/status/video").remove();
    }

    //SET EPISODE INFO
    if (data?.metas?.episodeNumber && (vlcPlaybackState.episode !== Number(data?.metas?.episodeNumber))) {
        firebase.database().ref("/session/" + mySessionID + "/status/episode").set(Number(data?.metas?.episodeNumber));
    } else if (!data?.metas?.episodeNumber && vlcPlaybackState.episode) {
        firebase.database().ref("/session/" + mySessionID + "/status/episode").remove();
    }

    //SET CONTENT NAME
    var contentName = data?.metas?.artist ? (data?.metas?.artist + " - " + ((data?.metas?.album && (data?.metas?.album !== data.name) && (data?.metas?.album !== data?.metas?.artist)) ? data?.metas?.album + " - " : "") + data.name) : data.name;
    if (contentName == data?.metas?.filename) contentName = null;
    if (contentName && (vlcPlaybackState.name !== contentName)) {
        firebase.database().ref("/session/" + mySessionID + "/status/name").set(contentName);
    } else if (!contentName && vlcPlaybackState.name) {
        firebase.database().ref("/session/" + mySessionID + "/status/name").remove();
    }

    //SET CONTENT TYPE
    if (data.tracks && data.tracks.audio && data.tracks.audio.length && data.tracks.video && data.tracks.video.length) {
        firebase.database().ref("/session/" + mySessionID + "/status/type").set("video");
    } else if (data.tracks && data.tracks.audio && data.tracks.audio.length) {
        firebase.database().ref("/session/" + mySessionID + "/status/type").set("audio");
    } else {
        firebase.database().ref("/session/" + mySessionID + "/status/type").remove();
    }

    //SET LENGTH
    if (data.length && (data.length !== vlcPlaybackState.length)) {
        firebase.database().ref("/session/" + mySessionID + "/status/length").set(data.length);
    } else if (!data.length) {
        firebase.database().ref("/session/" + mySessionID + "/status/length").remove();
    }

    //SET PLAY/PAUSE STATE
    if (data.state == "playing") {
        //Calculate expected time from database, update database time if it has been changed by allowedOffset (based on flags.allowedHostOffset and data.rate, see above)
        var shouldSync = false;
        if (vlcPlaybackState.state && vlcPlaybackState.state.startsWith("play|")) {
            let calculatedTime = (((getServerTime().getTime() - Number(vlcPlaybackState.state.split("|")[2])) / 1000) * vlcPlaybackState.rate) + Number(vlcPlaybackState.state.split("|")[1]);
            let adjustedTime = data.time + ((new Date().getTime() - preReqTime) / 1000);
            $("#syncOffset").text(Math.round((adjustedTime - calculatedTime) * 1000));
            shouldSync = Math.abs(adjustedTime - calculatedTime) > allowedOffset;
        } else {
            shouldSync = true;
        }

        if (forceVLCSkip || shouldSync) {
            let adjustedTime = data.time + ((new Date().getTime() - preReqTime) / 1000);
            firebase.database().ref("/session/" + mySessionID + "/status/state").set("play|" + adjustedTime + "|" + getServerTime().getTime()); //format: state|videoTime|clockTime
            forceVLCSkip = false; //reset force vlc skip flag after syncing
        }
    } else if (data.state == "paused") {
        //Set pause state if it's not already set
        if (vlcPlaybackState.state !== "pause|" + data.time) {
            firebase.database().ref("/session/" + mySessionID + "/status/state").set("pause|" + data.time);
        }
    } else if (data.state == "stopped") {
        //If VLC is stopped, remove playback state
        firebase.database().ref("/session/" + mySessionID + "/status/state").remove();
    }

    //SET PLAYBACK SPEED STATE
    if (!data.rate || (data.rate == 1)) {
        firebase.database().ref("/session/" + mySessionID + "/status/rate").remove();
    } else if (data.rate && (data.rate !== vlcPlaybackState.rate)) {
        firebase.database().ref("/session/" + mySessionID + "/status/rate").set(data.rate);
    }

    //SYNC SELECTED TRACK
    if (data.tracks) {
        //For each track type, set the track in the database or remove from the database if the track is disabled
        ["spu", "audio", "video"].forEach(trackType => {
            if (data.tracks[trackType]) {
                var activeTrack = data.tracks[trackType].find(t => t.selected); //find item in tracks array that is selected
                if (activeTrack) {
                    firebase.database().ref("/session/" + mySessionID + "/status/" + trackType + "Track").set(activeTrack.id); //store selected track ID if it exists
                } else {
                    firebase.database().ref("/session/" + mySessionID + "/status/" + trackType + "Track").remove(); //remove track from database if there is no selected track
                }
            }
        });
    }
}

//OPEN VLC ----------------------
function openVLC() {
    vlcIsOpen = false;
    load("Starting VLC...");
    return new Promise((fResolve, fReject) => {
        new Promise((resolve, reject) => {
            //Check the VLC exe path
            if (process.platform == "win32") {
                $("#redVLCPath").show();
            }

            if (process.platform == "linux") {
                resolve();
            } else if (fs.existsSync(VLC_EXE)) {
                resolve();
            } else if ((VLC_EXE == 'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe') && fs.existsSync('C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe')) {
                window.localStorage.vlcExePath = 'C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe';
                resolve();
            } else {
                actionNeeded("Cannot find VLC",
                    "Red cannot locate VLC on your computer. You can tell Red where VLC is by setting the VLC path in settings. Once you've done that, click the button below to try again.", [
                    {
                        text: "Try again",
                        action: () => {
                            openVLC().then(fResolve).catch(fReject);
                        }
                    }
                ])
            }
        }).then(() => {
            //Check if VLC is already open, if not, open it
            return new Promise((resolve, reject) => {
                jQuery.getJSON("http://localhost:7019/requests/jottocraft.json", (d) => { resolve(d); }).fail(function () {
                    if (process.platform == "win32") {
                        vlcProcess = execFile(VLC_EXE, ['--extraintf=http', '--http-port=7019', '--http-password=anime']);
                    } else {
                        vlcProcess = exec("vlc --extraintf=http --http-port=7019 --http-password=anime");
                    }                    
                    resolve();
                })
            });
        }).then((data) => {
            //Wait for VLC to open. If it is already open, skip this step
            return new Promise((resolve, reject) => {
                if (data) {
                    resolve(data);
                } else {
                    var resolved = false;
                    var checkVLC = setInterval(() => {
                        jQuery.getJSON("http://localhost:7019/requests/jottocraft.json", (r) => {
                            clearInterval(checkVLC);
                            if (!resolved) {
                                resolved = true;
                                resolve(r);
                            }
                        }).fail(function (e) {
                            if (e.status == 404) {
                                clearInterval(checkVLC);
                                resolved = true;
                                reject("vlcComm");
                            }
                        })
                    }, 1000);
                }
            })
        }).then((data) => {
            //Check for module updates
            if (data.jottocraft >= LATEST_MODULE_VER) {
                vlcIsOpen = true;
                fResolve();
            } else {
                actionNeeded("Update VLC module",
                    "There's a new version of the Red integration module for VLC. Click the button below to install the new version.", [
                    {
                        text: "Update module",
                        icon: "security",
                        action: () => {
                            installModule().then(() => {
                                openVLC().then(fResolve).catch(fReject);
                            })
                        }
                    }
                ])
            }
        }).catch(e => {
            if (e == "vlcComm") {
                //If unable to communicate with VLC, ask the user to install the module
                actionNeeded("Install VLC module",
                    "In order for Red to communicate with VLC, you'll need to install an integration module in VLC.\n\nThe module will only run when you are using Red.", [
                    {
                        text: "Install module",
                        icon: "security",
                        action: () => {
                            installModule().then(() => {
                                openVLC().then(fResolve).catch(fReject);
                            })
                        }
                    }
                ])
            } else {
                fReject(e);
            }
        });
    })
}

function installModule() {
    if (fs.existsSync(path.join(__dirname, "moduleinstaller.log"))) fs.unlinkSync(path.join(__dirname, "moduleinstaller.log"));
    return new Promise((resolve, reject) => {
        jQuery.get("http://localhost:7019/requests/jottocraft.json?command=quit", next).fail(function (e) {
            if (e.status == 404) {
                if (vlcProcess && vlcProcess.kill && vlcProcess.kill()) {
                    next();
                } else {
                    let res = false;
                    window.alert("Please close the VLC window so that the integration module can be installed");
                    load("Please close the VLC window...");
                    let interval = setInterval(() => {
                        jQuery.get("http://localhost:7019/requests/status.json").fail(function (e) {
                            if (!res) {
                                res = true;
                                clearInterval(interval);
                                next();
                            }
                        })
                    }, 1000);
                }
            } else {
                next();
            }
        });

        function next() {
            load("Installing module...");
            let res = false;
            let interval = setInterval(() => {
                if (fs.existsSync(path.join(__dirname, "moduleinstaller.log")) && !res) {
                    res = true;
                    clearInterval(interval);
                    fs.unlinkSync(path.join(__dirname, "moduleinstaller.log"));
                    load("Waiting for VLC to restart...");
                    resolve();
                }
            }, 1000);
            if (process.platform == "win32") {
                exec(`"${path.join(__dirname, "copymodule.bat").replace("/", "\\")}" "${path.join(VLC_EXE, "..").replace("/", "\\")}"`);
            }
        }
    })
}
//SERVER TIME
const timeSync = NtpTimeSync.default.getInstance({
    servers: [
        "time1.google.com",
        "time2.google.com",
        "time3.google.com",
        "time4.google.com"
    ]
});
var offset = null;
var runs = 0;
function calcOffset(isInterval) {
    return new Promise((resolve, reject) => {
        if (flags.timeSyncMethod == "ntp") {
            timeSync.getTime().then(function (result) {
                offset = result.offset;
                resolve();
            });
        } else {
            $.getJSON("https://backend.jottocraft.com/red/timesync/time", function (data) {
                var newOffset = new Date(data.serverTime).getTime() - new Date().getTime();
                if ((newOffset < offset) || (offset == null)) offset = newOffset;
                runs++;
                if (runs >= flags.offsetLimit) clearInterval(timerInterval);
                resolve();
            });
        }
    }).then(() => {
        if (isInterval) setTimeout(() => calcOffset(true), 10000);
    });
}
function getServerTime() {
    return new Date(new Date().getTime() + (offset || 0));
}

//Heartbeat for debugging clock synchronization
(function heartbeat() {
    $("#clockSecond").text(getServerTime().getSeconds());
    $("#clockHeartbeat").css("visibility", "visible");
    setTimeout(() => $("#clockHeartbeat").css("visibility", "hidden"), 100);

    setTimeout(heartbeat, 1000 - getServerTime().getMilliseconds());
})();

calcOffset(true);