const fs = require("fs");
const { shell, remote, app, ipcRenderer } = require('electron');
const path = require("path");
const { execFile, exec } = require("child_process");
const { dialog } = require('electron').remote;

//Latest VLC module version
const LATEST_MODULE_VER = 106;

//Local anime folder and VLC exe path vars
var ANIME_FOLDER = window.localStorage.animeFolderPath || path.join(__dirname, "..", "..", "/anime");
var VLC_EXE = window.localStorage.vlcExePath || 'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe';

//Database flags
var flags = {
    allowedOffset: 0.5
};

//Group variables
var groups, group, groupStatusDB, groupMemberDB, stats = {};

//VLC variables
var file, vlcOpen, vlcProcess, vlcStatus, localTrackSync = window.localStorage.localTrackSync != "false" ? true : false;

//HTTP request auth and configuration
jQuery.ajaxSetup({
    timeout: 1000, beforeSend: function (xhr) {
        xhr.setRequestHeader("Authorization", "Basic " + btoa(":anime"));
    }
});

var failCount = null; //# of times VLC failed to get a response from VLC (quit app after 3 consecutive fails)
var videoFail = 0; //# of times VLC failed to load the selected video file

setInterval(function () {
    if (vlcOpen) { //Only make web requests when VLC is open
        let preReq = new Date().getTime();
        jQuery.getJSON("http://localhost:9090/requests/jottocraft.json", function (data) {
            let reqOffset = (new Date().getTime() - preReq) / 1000;

            failCount = 0; //reset fail count

            vlcStatus = data; //set vlcStatus var

            var groupRate = group.status.rate || 1; //Get group rate

            var allowedOffset = flags.allowedOffset * groupRate; //Allowed offset (seconds) before VLC sync adjusts the time in VLC

            if (firebase.auth().currentUser.uid == group.status.host) {
                //HOST
                $("#hostBtn").hide();
                $("#renameBtn").show();

                //SET VIDEO FILE STATE
                if ((group.status.video !== vlcStatus?.information?.meta?.filename) && vlcStatus?.information?.meta?.filename) {
                    firebase.database().ref("/groups/" + group.id + "/status/video").set(vlcStatus?.information?.meta?.filename);
                } else if (!vlcStatus?.information?.meta?.filename) {
                    firebase.database().ref("/groups/" + group.id + "/status/video").remove();
                }

                //SET PLAY/PAUSE STATE
                if (vlcStatus.state == "playing") {
                    if (isNaN(getServerTime().getTime())) {
                        //If server time has not yet been calculated, reset the group state so the state will be set when server time is ready
                        firebase.database().ref("/groups/" + group.id + "/status/state").remove();
                    } else if (group.status.state && group.status.state.startsWith("play|")) {
                        //Calculate expected time from database, update database time if it has been changed by allowedOffset * 2
                        let time = (((getServerTime().getTime() - Number(group.status.state.split("|")[2])) / 1000) * groupRate) + Number(group.status.state.split("|")[1]);
                        if (Math.abs(time - vlcStatus.time) > (allowedOffset * 2)) {
                            firebase.database().ref("/groups/" + group.id + "/status/state").set("play|" + (vlcStatus.time - reqOffset) + "|" + getServerTime().getTime());
                        }
                    } else {
                        //If there is no current playback state, add it
                        firebase.database().ref("/groups/" + group.id + "/status/state").set("play|" + (vlcStatus.time - reqOffset) + "|" + getServerTime().getTime());
                    }
                } else if (vlcStatus.state == "paused") {
                    //Set pause state if it's not already set
                    if (group.status.state && (group.status.state.startsWith("pause|") && (vlcStatus.position !== Number(group.status.state.split("|")[1])))) {
                        firebase.database().ref("/groups/" + group.id + "/status/state").set("pause|" + vlcStatus.position);
                    } else {
                        firebase.database().ref("/groups/" + group.id + "/status/state").set("pause|" + vlcStatus.position);
                    }
                } else if (vlcStatus.state == "stopped") {
                    //If VLC is stopped, remove playback state
                    firebase.database().ref("/groups/" + group.id + "/status/state").remove();
                }

                //SET PLAYBACK SPEED STATE
                if (!vlcStatus.rate || (vlcStatus.rate == 1)) {
                    firebase.database().ref("/groups/" + group.id + "/status/rate").remove();
                } else if (vlcStatus.rate && (vlcStatus.rate !== group.status.rate)) {
                    firebase.database().ref("/groups/" + group.id + "/status/rate").set(vlcStatus.rate);
                }

                //SET TRACK STATE
                if (vlcStatus?.information?.tracks) {
                    //For each track type, set the track in the database or remove from the database if the track is disabled
                    if (vlcStatus.information.tracks.spu) {
                        vlcStatus.information.tracks.spu.forEach(track => {
                            if (track.active) {
                                if (track.item == "Disable") {
                                    firebase.database().ref("/groups/" + group.id + "/status/spuTrack").remove();
                                } else {
                                    firebase.database().ref("/groups/" + group.id + "/status/spuTrack").set(track.val);
                                }
                            }
                        })
                    }
                    if (vlcStatus.information.tracks.audio) {
                        vlcStatus.information.tracks.audio.forEach(track => {
                            if (track.active) {
                                if (track.item == "Disable") {
                                    firebase.database().ref("/groups/" + group.id + "/status/audioTrack").remove();
                                } else {
                                    firebase.database().ref("/groups/" + group.id + "/status/audioTrack").set(track.val);
                                }
                            }
                        })
                    }
                    if (vlcStatus.information.tracks.video) {
                        vlcStatus.information.tracks.video.forEach(track => {
                            if (track.active) {
                                if (track.item == "Disable") {
                                    firebase.database().ref("/groups/" + group.id + "/status/videoTrack").remove();
                                } else {
                                    firebase.database().ref("/groups/" + group.id + "/status/videoTrack").set(track.val);
                                }
                            }
                        })
                    }
                }
            } else {
                //CLIENT
                $("#hostBtn").show();
                $("#renameBtn").hide();

                if (group.status.video && file) {
                    //SYNC VIDEO STATE
                    if (videoFail >= 10) {
                        window.alert("VLC sync cannot open your video file in VLC. This probably means that the video you downloaded is corrupted. Try downloading the video again, then reopen VLC sync once you've fixed it.");
                        window.close();
                    }

                    //Open video in VLC if it's not already open
                    if (vlcStatus?.information?.meta?.filename) {
                        if (!file.endsWith(vlcStatus.information.meta.filename)) {
                            jQuery.get("http://localhost:9090/requests/jottocraft.json?command=playitem&name=" + encodeURI("VLC Sync - " + group.status.video) + "&input=" + file.replace("/", "\\"));
                            videoFail++;
                        } else {
                            videoFail = 0;
                        }
                    } else {
                        jQuery.get("http://localhost:9090/requests/jottocraft.json?command=playitem&name=" + encodeURI("VLC Sync - " + group.status.video) + "&input=" + file.replace("/", "\\"));
                        videoFail++;
                    }

                    //SYNC PLAYBACK SPEED STATE
                    if (group.status.rate && (vlcStatus.rate !== group.status.rate)) {
                        jQuery.get("http://localhost:9090/requests/jottocraft.json?command=rate&val=" + group.status.rate);
                    }

                    //SYNC PLAY/PAUSE STATE
                    if (group.status.state.startsWith("play|") || group.status.state.startsWith("pause|")) {
                        //Set video play/pause state
                        //Spec: play|video time|time (in ms) when the time was last set
                        //      pause|video time

                        if (group.status.state.startsWith("play|")) {
                            //Calculate expected time, update VLC time if it is off by more than the allowed offset
                            let time = (((getServerTime().getTime() - Number(group.status.state.split("|")[2])) / 1000) * groupRate) + Number(group.status.state.split("|")[1]);

                            if (time <= vlcStatus.length) {
                                if (vlcStatus.state == "paused") jQuery.get("http://localhost:9090/requests/jottocraft.json?command=play");
                                if (Math.abs(time - vlcStatus.time) > allowedOffset) {
                                    jQuery.get("http://localhost:9090/requests/jottocraft.json?command=directseek&val=" + (time + reqOffset));
                                }
                            }
                        } else if (group.status.state.startsWith("pause|")) {
                            //Seek and pause
                            if (vlcStatus.state == "playing") jQuery.get("http://localhost:9090/requests/jottocraft.json?command=pause");
                            let pos = Number(group.status.state.split("|")[1]) * 100;
                            jQuery.get("http://localhost:9090/requests/jottocraft.json?command=commonseek&val=" + pos + "%25");
                        }
                    }

                    //SYNC TRACK STATE
                    if (localTrackSync && vlcStatus?.information?.tracks) {
                        //If there is an active track 
                        var activeSpu = null;
                        vlcStatus.information.tracks.spu.forEach(t => { if (t.active) { activeSpu = t.val } });
                        if ((group.status.spuTrack !== undefined) && (activeSpu !== group.status.spuTrack)) {
                            jQuery.get("http://localhost:9090/requests/jottocraft.json?command=spu_track&val=" + group.status.spuTrack);
                        }

                        var activeAudio = null;
                        vlcStatus.information.tracks.audio.forEach(t => { if (t.active) { activeAudio = t.val } });
                        if ((group.status.audioTrack !== undefined) && (activeAudio !== group.status.audioTrack)) {
                            jQuery.get("http://localhost:9090/requests/jottocraft.json?command=audio_track&val=" + group.status.audioTrack);
                        }

                        var activeVideo = null;
                        vlcStatus.information.tracks.video.forEach(t => { if (t.active) { activeVideo = t.val } });
                        if ((group.status.videoTrack !== undefined) && (activeVideo !== group.status.videoTrack)) {
                            jQuery.get("http://localhost:9090/requests/jottocraft.json?command=video_track&val=" + group.status.videoTrack);
                        }
                    }
                } else {
                    jQuery.get("http://localhost:9090/requests/jottocraft.json?command=stop");
                }
            }
        }).fail(function () {
            if (failCount !== null) {
                failCount++;

                if (failCount == 3) {
                    window.close();
                }
            }
        })
    }
}, 100);

function displayGroup(groupID) {
    //set active group
    group = groups[groupID];

    //Show leave group button and group name
    $("#leaveBtn").show();
    $("#groupName").text(group.status.name);

    firebase.database().ref("/groups/" + group.id + "/members/" + firebase.auth().currentUser.uid).onDisconnect().remove();

    load("Waiting for VLC to open...");

    openVLC().then(() => {
        vlcOpen = true;

        load("Getting group status...");

        groupStatusDB = firebase.database().ref('/groups/' + groupID + '/status');
        groupStatusDB.on('value', function (snapshot) {
            group.status = snapshot.val();

            updateGroupSettings();

            $("#groupName").text(group.status.name);
            if (group.status.video) {
                if (firebase.auth().currentUser.uid == group.status.host) {
                    //host video selected
                    showLobby("sync", "Syncing playback", `
                        <p>The video you're playing in VLC is syncing to the members of this group.</p>
                        <br />
                        <p><b>Synced users</b>: <span id="statsReady">${stats.ready.length}</span></p>
                        <p><b>Users downloading</b>: <span id="statsDownloading">${stats.downloading.length}</span></p>
                    `, true);
                } else {
                    //Video selected
                    if (file && file.endsWith(group.status.video)) {
                        showPlayer(group);
                    } else {
                        scanForAnime(group.status.video, function (files) {
                            if (files.length == 1) {
                                file = files[0];

                                //Video downloaded
                                showPlayer(group);
                            } else if (!files.length) {
                                //Video needs to be downloaded
                                file = null;
                                showLobby("file_download", "Download video", `
                                    <div class="instructions">
                                        ${group.status.download ? `
                                            <p><b>Download File</b><p>
                                            <p>The host has provided a link to download the video file. <a onclick="shell.openExternal('${group.status.download}')" href="#">Click here</a> to open that link in your browser.</p>
                                            <br />
                                        ` : ``}
                                        <p><b>Copy the file to the anime folder</b><p>
                                        <p>Copy the folder or file(s) you downloaded, without renaming it, to the anime folder at <span class="animeFolderPath">${ANIME_FOLDER}</span>.</p>
                                        <br />
                                        <button onclick="moveAnimeFolder()" class="btn outline"><i class="material-icons">folder</i> Change anime folder location</button>
                                        <br /><br />
                                        <button onclick="showPlayer(group)" class="btn">Done</button>
                                    </div>
                                `, true);
                                firebase.database().ref("/groups/" + group.id + "/members/" + firebase.auth().currentUser.uid).set("downloading");
                            } else if (files.length > 1) {
                                file = null;
                                showLobby("file_copy", "File name conflict", `
                                    <p>Multiple files with the name "${group.status.video}" were found. Make sure you aren't renaming the file(s) and that the file names in the anime folder are unique.</p>
                                    <br />
                                    <button onclick="showPlayer(group)" class="btn">Try again</button>
                                `, true);
                                firebase.database().ref("/groups/" + group.id + "/members/" + firebase.auth().currentUser.uid).set("error");
                            }
                        });
                    }
                }
            } else {
                //Host hasn't selected a video
                if (firebase.auth().currentUser.uid == group.status.host) {
                    showLobby("file_copy", "Open a file in VLC", `
                        <p>Start playing a file in VLC to begin the video sync</p>
                        <br />
                        <p><b>Users waiting</b>: <span id="statsWaiting">${stats.waiting.length}</span></p>
                    `, true);
                } else if (!group.status.host) {
                    showLobby("person_outline", "Host disconnected", `
                        <p>The host of this group has left. You can take wait for the host to rejoin or take control of the group in the settings menu.</p>
                        <br />
                        <button onclick="host()" class="btn outline"><i class="material-icons">perm_identity</i> Take control</button>
                    `, true);
                } else {
                    showLobby("hourglass_empty", "Waiting for host...", "The host hasn't selected a video to play yet");
                    firebase.database().ref("/groups/" + group.id + "/members/" + firebase.auth().currentUser.uid).set("waiting");
                }
            }
        });
    });

    groupMemberDB = firebase.database().ref('/groups/' + groupID + '/members');
    groupMemberDB.on('value', function (snapshot) {
        var users = snapshot.val();

        group.members = users;

        stats = {
            downloading: [],
            plugin: [],
            waiting: [],
            ready: [],
            error: []
        }

        if (users) {
            Object.keys(users).forEach(user => {
                if (users[user] == "downloading") stats.downloading.push(user);
                if (users[user] == "plugin") stats.plugin.push(user);
                if (users[user] == "waiting") stats.waiting.push(user);
                if (users[user] == "ready") stats.ready.push(user);
                if (users[user] == "error") stats.error.push(user);
            });

            $("#statsDownloading").text(stats.downloading.length);
            $("#statsPlugin").text(stats.plugin.length);
            $("#statsWaiting").text(stats.waiting.length);
            $("#statsReady").text(stats.ready.length);
            $("#statsError").text(stats.error.length);
        }
    });
}

firebase.auth().onAuthStateChanged(function (user) {
    if (user) {
        console.log(user);

        function nextThing() {
            load("Getting group list...");
            firebase.database().ref('/flags').once('value').then((snap) => {
                var dbFlags = snap.val();
                if (dbFlags) flags = dbFlags;
                loadGroups().then(() => {
                    if (window.localStorage.groupID && groups[window.localStorage.groupID]) {
                        //load group
                        displayGroup(window.localStorage.groupID);
                    } else {
                        //load group selector
                        showLobby("groups", "Join a group", `
                            <br />
                            <div style="margin: 0px; margin-bottom: -20px;" class="row">
                                <button onclick="createGroup()" class="btn"><i class="material-icons">group_add</i> Create a group</button>
                                <button onclick="loadGroups()" class="btn outline"><i class="material-icons">refresh</i> Reload list</button>
                            </div>
                        `, true);
                        $("#groupList").show();
                    }
                });
            })
        }

        load("Searching for VLC exe...");
        if (fs.existsSync(VLC_EXE)) {
            nextThing();
        } else if ((VLC_EXE == 'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe') && fs.existsSync('C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe')) {
            window.localStorage.vlcExePath = 'C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe';
            nextThing();
        } else {
            showLobby("apps", "Cannot find VLC", `
                <p>VLC Sync cannot find the VLC exe on your computer. Make sure you have VLC installed, then click the button below to set the VLC exe path.</p>
                <br />
                <button onclick="setVLCPath()" class="btn outline"><i class="material-icons">insert_drive_file</i> Set VLC path</button>
            `, true);
        }
    } else {
        firebase.auth().signInAnonymously().catch(function (error) {
            console.log(error);
        });
    }
});

var results = [];
function scanForAnime(video, cb, folder = ANIME_FOLDER) {
    if (folder == ANIME_FOLDER) results = [];

    try {
        fs.readdirSync(folder).forEach(file => {
            try {
                if (fs.lstatSync(path.join(folder, file)).isDirectory()) {
                    scanForAnime(video, undefined, path.join(folder, file));
                } else if (file == video) {
                    results.push(path.join(folder, file));
                }
            } catch (e) { }
        });
    } catch (e) { }

    if (cb) cb(results);
}

var offset = Infinity;
var runs = 0;
function calcOffset() {
    jQuery.get("http://backend.jottocraft.com:8804/time", function (res, status, xhr) {
        var newOffset = new Date(Number(res)).getTime() - new Date().getTime();
        if (newOffset < offset) offset = newOffset;
        runs++;
        if (runs >= 50) clearInterval(timerInterval);
    });
}

function setVLCPath() {
    dialog.showOpenDialog({
        title: "Set VLC exe location",
        buttonLabel: "Set VLC exe",
        properties: ['openFile'],
        filters: [{ name: 'EXE File', extensions: ['exe'] }]
    }).then(function (results) {
        if (!results.canceled) {
            window.localStorage.vlcExePath = results.filePaths[0];
            window.location.reload();
        }
    });
}

function getServerTime() {
    var date = new Date();

    date.setTime(date.getTime() + offset);

    return date;
}

function openVLC() {
    return new Promise((fResolve, fReject) => {
        new Promise((resolve, reject) => {
            jQuery.getJSON("http://localhost:9090/requests/jottocraft.json", (d) => { resolve(d); }).fail(function () {
                vlcProcess = execFile(VLC_EXE, ['--extraintf=http', '--http-port=9090', '--http-password=anime', '--one-instance']);
                resolve();
            })
        }).then((data) => {
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
                                reject(e);
                            }
                        })
                    }, 1000);
                }
            })
        }).then((data) => {
            if (data.jottocraft >= LATEST_MODULE_VER) {
                fResolve();
            } else {
                showLobby("extension", "Update VLC Module", `
                <p>There's a newer version of the VLC sync integration module. Click the button below to install the latest version.</p>
                <p>Since VLC installs to the program files folder, you'll need to allow administrator access.</p>
                <br />
                <button id="installModBtn" class="btn"><i class="material-icons">security</i> Update the module</button>
            `, true);
                firebase.database().ref("/groups/" + group.id + "/members/" + firebase.auth().currentUser.uid).set("plugin");
                $("#installModBtn").click(() => {
                    installModule().then(() => {
                        openVLC().then(fResolve).catch(fReject);
                    })
                })
            }
        }).catch(e => {
            showLobby("extension", "Install VLC Module", `
                <p>In order for VLC Sync to communicate with VLC, you'll need to install the VLC sync integration module.</p>
                <p>Installing the module will not overwrite exiting VLC files and will only run when you are using VLC Sync.</p>
                <p>Since VLC installs to the program files folder, you'll need to allow administrator access to install the module.</p>
                <br />
                <button id="installModBtn" class="btn"><i class="material-icons">security</i> Install the module</button>
            `, true);
            firebase.database().ref("/groups/" + group.id + "/members/" + firebase.auth().currentUser.uid).set("plugin");
            $("#installModBtn").click(() => {
                installModule().then(() => {
                    openVLC().then(fResolve).catch(fReject);
                })
            })
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

function showPlayer(group) {
    if (group.status.video && file) {
        //Ready to show player
        if (group.status.state == "pause|0") {
            showLobby("schedule", "Waiting...", "The host is waiting for everyone to get ready. Video playback will begin automatically.");
            firebase.database().ref("/groups/" + group.id + "/members/" + firebase.auth().currentUser.uid).set("ready");
        } else {
            //Load video player
            if (group.status.state.startsWith("play|")) {
                showLobby("play_arrow", "Playing in VLC", `
                    <p>The video is playing in another window using VLC</p>
                    <br />
                    <div style="display: inline-block; text-align: left;">
                        <div id="trackSyncSwitch" onclick="toggleTrackSync()" class="switch ${localTrackSync ? "active" : ""}"><span class="head"></span></div>
                        <div class="label"><i class="material-icons">subtitles</i> Sync subtitles, audio, and video tracks</div>
                    </div>
                `, true);
            } else if (group.status.state.startsWith("pause|")) {
                showLobby("pause", "VLC Paused", "The host has paused the video in VLC")
            }
            firebase.database().ref("/groups/" + group.id + "/members/" + firebase.auth().currentUser.uid).set("ready");
        }
    } else if (group.status.video && !file) {
        //Try scanning for files again
        scanForAnime(group.status.video, function (files) {
            if (files.length == 1) {
                file = files[0];
                showPlayer(group);
            } else if (files.length == 0) {
                file = null;
                fluid.alert("File not found", "The video file was not found in the anime folder. Make sure you followed all of the steps correctly and try again.", "warning");
            } else if (files.length > 1) {
                file = null;
                fluid.alert("File name conflict", `Multiple files with the name "${group.status.video}" were found. Make sure you aren't renaming the file(s) and that the file names in the anime folder are unique.`, "warning");
            }
        });
    }
}

function toggleTrackSync() {
    $("#trackSyncSwitch").toggleClass("active");
    if ($("#trackSyncSwitch").hasClass("active")) {
        localTrackSync = true;
        window.localStorage.setItem("localTrackSync", true);
    } else {
        localTrackSync = false;
        window.localStorage.setItem("localTrackSync", false);
    }
}

function joinGroup(groupID) {
    load("Joining group...");
    window.localStorage.setItem("groupID", groupID);
    displayGroup(groupID);
}

function leaveGroup() {
    window.localStorage.removeItem("groupID");
    clearData().then(() => {
        readyToQuit = true;
        window.onbeforeunload = null;
        window.location.reload();
    });
}

function showLobby(icon, title, description, htmlAllowed) {
    $("#lobbyIcon").text(icon);
    $("#lobbyTitle").text(title);

    if (htmlAllowed) {
        $("#lobbyDescription").html(description);
    } else {
        $("#lobbyDescription").text(description);
    }

    $("#groupList").hide();
    $("#lobby").show();
    $("#loading").hide();
    $("#toolbar").show();
}

function load(state) {
    $("#toolbar").hide();
    $("#loading").show();
    $("#lobby").hide();
    $("#settings").hide();
    $("#loadingState").html(state || "");
}

function renameGroup() {
    var name = $("#groupNameSetting").val();
    firebase.database().ref("/groups/" + group.id + "/status/name").set(name);
}

function setGroupDownload() {
    var download = $("#groupDownloadSetting").val();
    firebase.database().ref("/groups/" + group.id + "/status/download").set(download);
}

function host() {
    firebase.database().ref("/groups/" + group.id + "/status/host").set(firebase.auth().currentUser.uid);
    firebase.database().ref("/groups/" + group.id + "/members/" + firebase.auth().currentUser.uid).remove();
}

function moveAnimeFolder(cb) {
    dialog.showOpenDialog({
        title: "Change anime folder location",
        buttonLabel: "Set anime folder",
        properties: ['openDirectory']
    }).then(function (results) {
        if (!results.canceled) {
            ANIME_FOLDER = results.filePaths[0];
            $(".animeFolderPath").text(ANIME_FOLDER);
            window.localStorage.animeFolderPath = ANIME_FOLDER;
            if (cb) cb();
        }
    });
}

function addGroup() {
    var newID = new Date().getTime();
    var newName = $("#newGroupName").val();
    if (newName) {
        firebase.database().ref("/groups/" + newID).set({
            createdBy: "anonymous",
            id: newID,
            status: {
                visible: true,
                host: firebase.auth().currentUser.uid,
                name: newName
            }
        }).then(() => {
            loadGroups().then(() => {
                closeSettings();
                joinGroup(newID);
            });
        });
    } else {
        window.alert("Invalid group name");
    }
}

function settings() {
    $(".animeFolderPath").text(ANIME_FOLDER);

    if (firebase.auth().currentUser.isAnonymous || !firebase.auth().currentUser.email) {
        $("#settingsLoginText").html(`Signed in as anonymous user <span class="userID">${firebase.auth().currentUser.uid}</span>
         <!--(<a style="cursor: pointer" onclick="logout();">Sign out</a>)-->`);
    } else {
        $("#settingsLoginText").html(`Signed in as ${firebase.auth().currentUser.email} (<a style="cursor: pointer" onclick="logout();">Sign out</a>)`);
    }

    updateGroupSettings();

    $("#settings").show();
    $("#settingsBtn").hide();
    $("#backBtn").show();
}

function createGroup() {
    $("#createGroup").show();
    $("#settingsBtn").hide();
    $("#backBtn").show();
}

function updateGroupSettings() {
    $(".hostSettings").hide();

    if (group) {
        $("#groupNameSetting").val(group.status.name);
        $("#groupDownloadSetting").val(group.status.download);

        if (group.createdBy == firebase.auth().currentUser.uid) {
            $(".hostSettings.activeOwner").show();
        } else if (group.status.host == firebase.auth().currentUser.uid) {
            $(".hostSettings.activeHost").show();
        }

        if (!group.hostLocked && (group.status.host !== firebase.auth().currentUser.uid)) {
            $(".hostSettings.takeControl").show();
        }
    }
}

function closeSettings() {
    $("#settingsBtn").show();
    $("#backBtn, #createGroup, #settings").hide();
}

function logout() {
    firebase.auth().signOut().then(leaveGroup);
}

function loadGroups() {
    $("#groupList").html(``);
    return new Promise((resolve, reject) => {
        firebase.database().ref('/groups').once('value').then(data => {
            groups = data.val();
            var groupHTML = ``;

            Object.values(groups).forEach(group => {
                if (group.status && group.status.visible) {
                    groupHTML += `<div class="group"><span class="name">${group.status.name}</span><a onclick="joinGroup('${group.id}')" class="join">Join</a></div>`;
                    $("#groupList").html(groupHTML);
                }
            })

            resolve();
        });
    })
}

function clearData() {
    console.log("called")
    return new Promise((resolve, reject) => {
        var isHost = group.status.host == firebase.auth().currentUser.uid;
        var activeMembers = (group.members ? Object.keys(group.members).length : 0) + (group.status.host ? 1 : 0);
        var tasks = [];

        //Stop getting realtime data
        if (groupMemberDB && groupMemberDB.off) groupMemberDB.off();
        if (groupStatusDB && groupStatusDB.off) groupStatusDB.off();
        console.log("b")
        if ((group.createdBy == "anonymous") && (activeMembers <= 1)) {
            //Anonymous group that needs to be deleted
            tasks.push(firebase.database().ref("/groups/" + group.id).remove());
        } else {
            tasks.push(firebase.database().ref("/groups/" + group.id + "/members/" + firebase.auth().currentUser.uid).remove());

            if (isHost) {
                tasks.push(firebase.database().ref("/groups/" + group.id + "/status/audioTrack").remove());
                tasks.push(firebase.database().ref("/groups/" + group.id + "/status/videoTrack").remove());
                tasks.push(firebase.database().ref("/groups/" + group.id + "/status/spuTrack").remove());
                tasks.push(firebase.database().ref("/groups/" + group.id + "/status/state").remove());
                tasks.push(firebase.database().ref("/groups/" + group.id + "/status/video").remove());
                tasks.push(firebase.database().ref("/groups/" + group.id + "/status/rate").remove());
                tasks.push(firebase.database().ref("/groups/" + group.id + "/status/host").remove());
            }
        }

        console.log(tasks)

        Promise.allSettled(tasks).then(resolve);
    })
}

var timerInterval = setInterval(calcOffset, 5000);
calcOffset();
var readyToQuit = false;
window.onbeforeunload = (e) => {
    try {
        //Stop checking VLC
        vlcOpen = false;

        //Prepare warning interval
        setTimeout(() => {
            load("This shouldn't be taking this long. You'll probably have to force quit this app.");
        }, 10000);

        if (!readyToQuit && group) {
            load("Leaving group...");

            clearData().then(() => {
                readyToQuit = true;
                ipcRenderer.send('app_quit');
                window.onbeforeunload = null;
            }).catch(() => {
                readyToQuit = true;
                ipcRenderer.send('app_quit');
                window.onbeforeunload = null;
            });
        } else {
            readyToQuit = true;
            window.onbeforeunload = null;
            delete e['returnValue'];
        }
    } catch (err) {
        console.error(err);
        readyToQuit = true;
        window.onbeforeunload = null;
        delete e['returnValue'];
        window.close();
    }
}