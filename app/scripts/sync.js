const fs = require("fs");
const { execFile, exec } = require("child_process");
const path = require("path");

//Latest VLC module version
const LATEST_MODULE_VER = 106;

//Local anime folder and VLC exe path vars
var VLC_EXE = window.localStorage.vlcExePath || 'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe';

//VLC processes and sync vars
var vlcProcess, vlcIsOpen, forceVLCSkip = false, flags = {
    allowedOffset: 0.6,
    hostOffsetMultiplier: 2,
    offsetLimit: 50
};

//HTTP request auth and configuration
jQuery.ajaxSetup({
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
        jQuery.getJSON("http://localhost:9090/requests/jottocraft.json", function (data) {
            let reqOffset = (new Date().getTime() - preReq) / 1000;

            if (data.length) {
                $("#sessionStatusBar .videoDuration").text(minutesAndSeconds(data.length * 1000));
                $("#sessionStatusBar .videoDuration").parent().show();
            } else {
                $("#sessionStatusBar .videoDuration").parent().hide();
            }

            if (vlcPlaybackState.host) {
                //HOST
                syncHostPlayback(data, reqOffset);
            } else {
                //CLIENT
                setClientPlayback(data, reqOffset);
            }
        });
    }
}, 500);

function setClientPlayback(data, reqOffset) {
    var allowedOffset = flags.allowedOffset * vlcPlaybackState.rate;

    if (vlcPlaybackState.video && file) {
        //SYNC VIDEO STATE
        if (videoFail >= 10) {
            window.alert("Red cannot open your video file in VLC. This probably means that the video you downloaded is corrupted.");
            window.close();
        }

        //Open video in VLC if it's not already open
        if (data?.information?.meta?.filename) {
            if (!file.endsWith(data.information.meta.filename)) {
                jQuery.get("http://localhost:9090/requests/jottocraft.json?command=playitem&name=" + encodeURI("Red - " + vlcPlaybackState.video) + "&input=" + file.replace("/", "\\"));
                videoFail++;
            } else {
                videoFail = 0;
            }
        } else {
            jQuery.get("http://localhost:9090/requests/jottocraft.json?command=playitem&name=" + encodeURI("Red - " + vlcPlaybackState.video) + "&input=" + file.replace("/", "\\"));
            videoFail++;
        }

        //SYNC PLAYBACK SPEED STATE
        if (vlcPlaybackState.rate && (data.rate !== vlcPlaybackState.rate)) {
            jQuery.get("http://localhost:9090/requests/jottocraft.json?command=rate&val=" + vlcPlaybackState.rate);
        }

        //SYNC PLAY/PAUSE STATE
        if (vlcPlaybackState.state.startsWith("play|") || vlcPlaybackState.state.startsWith("pause|")) {
            //Set video play/pause state
            //Spec: play|video time|time (in ms) when the time was last set
            //      pause|video time

            if (vlcPlaybackState.state.startsWith("play|")) {
                //Calculate expected time, update VLC time if it is off by more than the allowed offset
                let time = (((getServerTime().getTime() - Number(vlcPlaybackState.state.split("|")[2])) / 1000) * vlcPlaybackState.rate) + Number(vlcPlaybackState.state.split("|")[1]);

                if (time <= data.length) {
                    if (data.state == "paused") jQuery.get("http://localhost:9090/requests/jottocraft.json?command=play");
                    if (forceVLCSkip || (Math.abs(data.time - time) > allowedOffset)) {
                        jQuery.get("http://localhost:9090/requests/jottocraft.json?command=directseek&val=" + (time + reqOffset + 0.1));
                        forceVLCSkip = false;

                        if (data.length && (fluid.get("pref-discordSync") !== "false")) {
                            ipcRenderer.send("discord-activity", {
                                details: $("#sessionStatusBar .videoName").text(),
                                state: sessionDBCache.info.content,
                                timestamps: {
                                    startAt: startAt,
                                    endAt: new Date((new Date().getTime() + (((data.length - (time + reqOffset + 0.1)) / vlcPlaybackState.rate) * 1000)) / 1000)
                                }
                            })
                        }
                    }
                }

                let percentage = time / data.length;
                $("#visualPlaybackState").css("width", (percentage * 100) + "%");
                $("#visualPlaybackState").show();
            } else if (vlcPlaybackState.state.startsWith("pause|")) {
                //Seek and pause
                if (data.state == "playing") jQuery.get("http://localhost:9090/requests/jottocraft.json?command=pause");
                let pos = Number(vlcPlaybackState.state.split("|")[1]) * 100;
                jQuery.get("http://localhost:9090/requests/jottocraft.json?command=commonseek&val=" + pos + "%25");

                $("#visualPlaybackState").css("width", pos + "%");
                $("#visualPlaybackState").show();

                if (data.length && (fluid.get("pref-discordSync") !== "false")) {
                    ipcRenderer.send("discord-activity", {
                        details: $("#sessionStatusBar .videoName").text(),
                        state: sessionDBCache.info.content
                    })
                }
            } else {
                $("#visualPlaybackState").hide();
            }
        } else {
            $("#visualPlaybackState").hide();
        }

        //SYNC TRACK STATE
        if ((fluid.get("pref-trackSync") !== "false") && data?.information?.tracks) {
            //If there is an active track 
            var activeSpu = null;
            var selectedSpu = null;
            data.information.tracks.spu.forEach(t => { if (t.active) { activeSpu = t.val; } if (t.item == vlcPlaybackState.spuTrack) { selectedSpu = t.val; } });
            if (selectedSpu && (activeSpu !== selectedSpu)) {
                jQuery.get("http://localhost:9090/requests/jottocraft.json?command=spu_track&val=" + selectedSpu);
            }

            var activeAudio = null;
            var selectedAudio = null;
            data.information.tracks.audio.forEach(t => { if (t.active) { activeAudio = t.val } if (t.item == vlcPlaybackState.audioTrack) { selectedAudio = t.val; } });
            if (selectedAudio && (activeAudio !== vlcPlaybackState.audioTrack)) {
                jQuery.get("http://localhost:9090/requests/jottocraft.json?command=audio_track&val=" + selectedAudio);
            }

            var activeVideo = null;
            var selectedVideo = null;
            data.information.tracks.video.forEach(t => { if (t.active) { activeVideo = t.val } if (t.item == vlcPlaybackState.videoTrack) { selectedVideo = t.val; } });
            if (selectedVideo && (activeVideo !== vlcPlaybackState.videoTrack)) {
                jQuery.get("http://localhost:9090/requests/jottocraft.json?command=video_track&val=" + selectedVideo);
            }
        }
    } else {
        jQuery.get("http://localhost:9090/requests/jottocraft.json?command=stop");
    }
}

function syncHostPlayback(data, reqOffset) {
    var allowedOffset = flags.allowedOffset * vlcPlaybackState.rate * flags.hostOffsetMultiplier;

    //SET VIDEO FILE STATE
    if ((vlcPlaybackState.video !== data?.information?.meta?.filename) && data?.information?.meta?.filename) {
        firebase.database().ref("/session/" + mySessionID + "/status/video").set(data?.information?.meta?.filename);
    } else if (!data?.information?.meta?.filename && vlcPlaybackState.video) {
        firebase.database().ref("/session/" + mySessionID + "/status/video").remove();
    }

    //GET EPISODE INFO
    var episodeData = null;
    if (data?.information?.meta?.episodeNumber) {
        episodeData = (data?.information?.meta?.seasonNumber ? "S" + data?.information?.meta?.seasonNumber : "") + "E" + data?.information?.meta?.episodeNumber;
    }

    //SET EPISODE INFO
    if ((vlcPlaybackState.episode !== episodeData) && episodeData) {
        firebase.database().ref("/session/" + mySessionID + "/status/episode").set(episodeData);
    } else if (!episodeData && vlcPlaybackState.episode) {
        firebase.database().ref("/session/" + mySessionID + "/status/episode").remove();
    }

    //SET PLAY/PAUSE STATE
    if (data.state == "playing") {
        if (isNaN(getServerTime().getTime())) {
            //If server time has not yet been calculated, reset the playback state so the state will be set when server time is ready
            firebase.database().ref("/session/" + mySessionID + "/status/state").remove();
            $("#visualPlaybackState").hide();
        } else if (vlcPlaybackState.state && vlcPlaybackState.state.startsWith("play|")) {
            //Calculate expected time from database, update database time if it has been changed by allowedOffset * 2
            let time = (((getServerTime().getTime() - Number(vlcPlaybackState.state.split("|")[2])) / 1000) * vlcPlaybackState.rate) + Number(vlcPlaybackState.state.split("|")[1]);
            if (forceVLCSkip || (Math.abs(data.time - time) > allowedOffset)) {
                firebase.database().ref("/session/" + mySessionID + "/status/state").set("play|" + (data.time - reqOffset) + "|" + getServerTime().getTime());
                forceVLCSkip = false;

                if (data.length && data.time && (fluid.get("pref-discordSync") !== "false")) {
                    ipcRenderer.send("discord-activity", {
                        details: $("#sessionStatusBar .videoName").text(),
                        state: sessionDBCache.info.content,
                        timestamps: {
                            startAt: startAt,
                            endAt: new Date((new Date().getTime() + (((data.length - (data.time - reqOffset)) / vlcPlaybackState.rate) * 1000)) / 1000)
                        }
                    })
                }
            }

            let percentage = time / data.length;
            $("#visualPlaybackState").css("width", (percentage * 100) + "%");
            $("#visualPlaybackState").show();
        } else {
            //If there is no current playback state, add it
            firebase.database().ref("/session/" + mySessionID + "/status/state").set("play|" + (data.time - reqOffset) + "|" + getServerTime().getTime());

            if (data.length && data.time && (fluid.get("pref-discordSync") !== "false")) {
                ipcRenderer.send("discord-activity", {
                    details: $("#sessionStatusBar .videoName").text(),
                    state: sessionDBCache.info.content,
                    timestamps: {
                        startAt: startAt,
                        endAt: new Date((new Date().getTime() + (((data.length - (data.time - reqOffset)) / vlcPlaybackState.rate) * 1000)) / 1000)
                    }
                })
            }
        }
    } else if (data.state == "paused") {
        //Set pause state if it's not already set
        if (vlcPlaybackState.state && (vlcPlaybackState.state !== "pause|" + data.position)) {
            firebase.database().ref("/session/" + mySessionID + "/status/state").set("pause|" + data.position);

            $("#visualPlaybackState").css("width", (Number(data.position) * 100) + "%");
            $("#visualPlaybackState").show();

            if (data.length && (fluid.get("pref-discordSync") !== "false")) {
                ipcRenderer.send("discord-activity", {
                    details: $("#sessionStatusBar .videoName").text(),
                    state: sessionDBCache.info.content
                })
            }
        }
    } else if (data.state == "stopped") {
        //If VLC is stopped, remove playback state
        firebase.database().ref("/session/" + mySessionID + "/status/state").remove();
        $("#visualPlaybackState").hide();
    } else {
        $("#visualPlaybackState").hide();
    }

    //SET PLAYBACK SPEED STATE
    if (!data.rate || (data.rate == 1)) {
        firebase.database().ref("/session/" + mySessionID + "/status/rate").remove();
    } else if (data.rate && (data.rate !== vlcPlaybackState.rate)) {
        firebase.database().ref("/session/" + mySessionID + "/status/rate").set(data.rate);
    }

    //SET TRACK STATE
    if (data?.information?.tracks) {
        //For each track type, set the track in the database or remove from the database if the track is disabled
        if (data.information.tracks.spu) {
            data.information.tracks.spu.forEach(track => {
                if (track.active) {
                    if (track.item == "Disable") {
                        firebase.database().ref("/session/" + mySessionID + "/status/spuTrack").remove();
                    } else {
                        firebase.database().ref("/session/" + mySessionID + "/status/spuTrack").set(track.item);
                    }
                }
            })
        }
        if (data.information.tracks.audio) {
            data.information.tracks.audio.forEach(track => {
                if (track.active) {
                    if (track.item == "Disable") {
                        firebase.database().ref("/session/" + mySessionID + "/status/audioTrack").remove();
                    } else {
                        firebase.database().ref("/session/" + mySessionID + "/status/audioTrack").set(track.item);
                    }
                }
            })
        }
        if (data.information.tracks.video) {
            data.information.tracks.video.forEach(track => {
                if (track.active) {
                    if (track.item == "Disable") {
                        firebase.database().ref("/session/" + mySessionID + "/status/videoTrack").remove();
                    } else {
                        firebase.database().ref("/session/" + mySessionID + "/status/videoTrack").set(track.item);
                    }
                }
            })
        }
    }
}


//OPEN VLC ----------------------
function openVLC() {
    vlcIsOpen = false;
    load("Starting VLC...");
    return new Promise((fResolve, fReject) => {
        new Promise((resolve, reject) => {
            //Check the VLC exe path
            if (fs.existsSync(VLC_EXE)) {
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
                jQuery.getJSON("http://localhost:9090/requests/jottocraft.json", (d) => { resolve(d); }).fail(function () {
                    vlcProcess = execFile(VLC_EXE, ['--extraintf=http', '--http-port=9090', '--http-password=anime', '--one-instance']);
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
                        jQuery.getJSON("http://localhost:9090/requests/jottocraft.json", (r) => {
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
        jQuery.get("http://localhost:9090/requests/jottocraft.json?command=quit", next).fail(function (e) {
            if (e.status == 404) {
                if (vlcProcess && vlcProcess.kill && vlcProcess.kill()) {
                    next();
                } else {
                    let res = false;
                    window.alert("Please close the VLC window so that the integration module can be installed");
                    load("Please close the VLC window...");
                    let interval = setInterval(() => {
                        jQuery.get("http://localhost:9090/requests/status.json").fail(function (e) {
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
            exec(`"${path.join(__dirname, "copymodule.bat").replace("/", "\\")}" "${path.join(VLC_EXE, "..").replace("/", "\\")}"`);
        }
    })
}

//SERVER TIME
function getServerTime() {
    var date = new Date();

    date.setTime(date.getTime() + offset);

    return date;
}

var offset = Infinity;
var runs = 0;
function calcOffset() {
    return new Promise((resolve, reject) => {
        jQuery.get("http://backend.jottocraft.com:8804/time", function (res, status, xhr) {
            var newOffset = new Date(Number(res)).getTime() - new Date().getTime();
            if (newOffset < offset) offset = newOffset;
            runs++;
            if (runs >= flags.offsetLimit) clearInterval(timerInterval);
            resolve();
        });
    })
}

var timerInterval = setInterval(calcOffset, 5000);
calcOffset();