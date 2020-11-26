const { dialog, app, shell, clipboard } = require('electron').remote;
const { ipcRenderer } = require('electron');

//Cache
var MALcache = {}, namesCache = {}, sessionDBCache = {}, isGlobalAdmin = false;

//Videos folder
var VIDEO_FOLDER = window.localStorage.videoFolderPath || app.getPath("videos");

//Local variables
var file, fileOverrides = {}, vlcPlaybackState = {};

//Session variables
var sessionDB = [], userStatus, mySessionID, dbConnection = false;

//Local Storage
if (window.localStorage.getItem("fileOverrides")) {
    fileOverrides = JSON.parse(window.localStorage.getItem("fileOverrides"));
}

//Listen for deep link events in the format "jottocraft-red://[sessionID]/[accessCode]"
ipcRenderer.on("deepLinkArgs", (event, msg) => {
    msg.forEach(item => {
        if (item.startsWith("jottocraft-red://")) {
            var sessionID = item.replace("jottocraft-red://", "").split("/")[0];
            var accessCode = item.replace("jottocraft-red://", "").split("/")[1] || undefined;
            joinSession(sessionID, accessCode);
        }
    });
})

//Listen for fluid theme change
document.addEventListener("fluidTheme", function (data) {
    if (isGlobalAdmin && (data.detail !== "sat")) {
        fluid.theme("sat");
    } else if (!isGlobalAdmin && (data.detail == "sat")) {
        fluid.theme("system");
    }
});

//Authentication
firebase.auth().onAuthStateChanged(function (user) {
    if (user) {

        console.log(user);

        if (oauthIsListening) {
            //Stop oauth server once login is complete
            oauthIsListening = false;
            oauthListener.close();
        }

        function getProfile() {
            load("Getting profile...");
            firebase.database().ref("/users/username/" + user.uid).once("value").then((snap) => {
                var data = snap.val();

                if (firebase.auth().currentUser.isAnonymous) {
                    window.localStorage.setItem("usesAnonymousAccount", "true");
                    data = "Guest";
                } else {
                    window.localStorage.removeItem("usesAnonymousAccount");
                }

                $(document).ready(() => {
                    if (data) {
                        if (firebase.auth().currentUser.photoURL) {
                            $(".profileImage").css("background-image", "url('" + firebase.auth().currentUser.photoURL + "')");
                            $(".profileImage").html("");
                        } else {
                            $(".profileImage").css("background-image", "");
                            $(".profileImage").html(`<i class="material-icons">account_circle</i>`);
                        }
                        $(".profileImage").show();
                        $(".profileMenu .redEmail").text(user.email || "You are using a Guest account");
                        $(".profileMenu .redRole").text("");
                        isGlobalAdmin = false;

                        firebase.auth().currentUser.getIdTokenResult().then((idTokenResult) => {
                            console.log(idTokenResult);
                            if (idTokenResult && idTokenResult.claims && idTokenResult.claims.globalAdmin) {
                                isGlobalAdmin = true;
                                $(".profileMenu .redRole").text("GLOBAL ADMIN");
                                if (!fluid.config.allowedThemes.includes("sat")) fluid.config.allowedThemes.push("sat");
                                fluid.theme("sat");
                                $(".navitem.globalAdmin").show();
                            } else {
                                if (fluid.config.allowedThemes.includes("sat")) fluid.config.allowedThemes = fluid.config.allowedThemes.filter(e => e !== 'sat');
                                if (fluid.theme() == "sat") fluid.theme("system");
                                $(".navitem.globalAdmin").hide();
                            }
                        });

                        hideLoginScreen();
                        load("Starting VLC...");
                        openVLC().then(() => {
                            load("Getting sessions...");
                            getSessions().then((data) => {
                                if (window.localStorage.activeSession && data.includes(window.localStorage.activeSession)) {
                                    joinSession(window.localStorage.activeSession);
                                } else {
                                    getSessions(true).then(() => {
                                        doneLoading();
                                        sessionScreen("list")
                                    });
                                }
                            });
                        });
                    } else {
                        showLoginScreen();
                        setANameUI(getProfile);
                        doneLoading();
                    }
                });
            })
        }

        getProfile();
    } else {
        if (window.localStorage.getItem("usesAnonymousAccount") == "true") {
            //This user was using a temporary account that got deleted, generate a new one
            anonymousLogin();
        } else {
            $(document).ready(() => {
                $(".profileImage").hide();
                doneLoading();
                showLoginScreen();
            });
        }
    }
});

function joinSession(id, accessCode) {
    load("Joining session...");

    //Join session
    userStatus = "joining";
    new Promise((resolve, reject) => {
        if (isGlobalAdmin && (fluid.get("pref-adminStealth") == "true")) {
            resolve();
        } else {
            firebase.database().ref("/session/" + id + "/members/" + firebase.auth().currentUser.uid).set(accessCode || "joining").then(resolve).catch(reject);
        }
    }).then(() => {
        //Set as active session
        if (!(isGlobalAdmin && (fluid.get("pref-adminStealth") == "true"))) {
            window.localStorage.setItem("activeSession", id);
        }
        mySessionID = id;
        sessionScreen("session");
        $("#sessionID").text(id);

        var firstrun = false, groupInfo, richContent;

        //Member status listener
        var connectedDB = firebase.database().ref('.info/connected');
        sessionDB.push(connectedDB);
        connectedDB.on('value', function (snapshot) {
            // If we're not currently connected, don't do anything.
            if (snapshot.val() == false) {
                dbConnection = false;
                return;
            };

            firebase.database().ref("/session/" + id + "/members/" + firebase.auth().currentUser.uid).onDisconnect().remove().then(function () {
                dbConnection = true;
                if (!(isGlobalAdmin && (fluid.get("pref-adminStealth") == "true"))) {
                    firebase.database().ref("/session/" + id + "/members/" + firebase.auth().currentUser.uid).set(userStatus);
                }
            });
        });

        //Add info listener
        var infoDB = firebase.database().ref("/session/" + id + "/info");
        sessionDB.push(infoDB);
        infoDB.on('value', snap => {
            var data = snap.val();
            sessionDBCache.info = data;
            groupInfo = data;

            if (!data) {
                //All sessions should have info
                window.alert("The session you are trying to join does not exist");
                leaveSession();
                return;
            }

            //Set session name
            $("#sessionName").text(data.name);

            //Update settings UI
            $("#sessionNameSetting").val(data.name || "");
            $("#sessionStartTime").val(data.scheduledStart ? moment(data.scheduledStart).format(moment.HTML5_FMT.DATETIME_LOCAL) : "");
            $("#sessionContentName").val(data.content || "");
            $("#sessionDownloadURL").val(data.download || "");

            if (data.scheduledStart) {
                $("#sessionStartTimeReveal").addClass("active");
                $("#sessionStartTimeContainer").show();
            } else {
                $("#sessionStartTimeReveal").removeClass("active");
                $("#sessionStartTimeContainer").hide();
            }

            if (data.contentID && data.contentID.startsWith("mal.")) {
                var malID = data.contentID.replace("mal.", "");
                new Promise((resolve, reject) => {
                    //resolve({});
                    //return;
                    if (MALcache[malID]) {
                        resolve(MALcache[malID]);
                    } else {
                        $.getJSON("https://api.jikan.moe/v3/anime/" + malID, malData => {
                            MALcache[malID] = malData;
                            resolve(malData);
                        }).fail(reject);
                    }
                }).then(data => {
                    $("#sessionStatusScreen .sessionImage").attr("src", data.image_url);
                    $("#sessionStatusScreen .sessionImage").show();
                    $("#richContent").show();
                    richContent = data;

                    $("#richContent h5").text(data.title);
                    $("#richContentLink").attr("onclick", "shell.openExternal('" + data.url + "')");
                    $("#richContentLink span").text("View on MyAnimeList");

                    if (data.episodes) {
                        $("#richContentEpisodes span").text(data.episodes + " episodes");
                    } else {
                        $("#richContentEpisodes").hide();
                    }

                    if (data.duration) {
                        $("#richContentLength span").text(data.duration);
                    } else {
                        $("#richContentLength").hide();
                    }

                    if (data.airing && data.broadcast) {
                        $("#richContentAiring span").text(data.broadcast);
                    } else {
                        $("#richContentAiring").hide();
                    }

                    malUI(data);
                    doneLoading();

                    if (!firstrun) {
                        firstrun = true;
                        getGroupState();
                    }
                }).catch(() => {
                    //Unable to fetch rich content
                    $("#sessionStatusScreen .sessionImage").hide();
                    $("#richContent").hide();
                    malUI("off");
                    richContent = null;
                    doneLoading();
                    $("#sessionContentName").val(data.content || "");

                    if (!firstrun) {
                        firstrun = true;
                        getGroupState();
                    }
                })
            } else {
                $("#sessionStatusScreen .sessionImage").hide();
                $("#richContent").hide();
                malUI("off");
                richContent = null;
                doneLoading();

                if (!firstrun) {
                    firstrun = true;
                    getGroupState();
                }
            }
        })

        function getGroupState() {
            //Add status listener
            var statusDB = firebase.database().ref("/session/" + id + "/status");
            sessionDB.push(statusDB);
            statusDB.on('value', snap => {
                var data = snap.val();
                sessionDBCache.status = data;

                setNavVisibility("infoEditNav", false, "statusAND");

                $("#sessionStatusBar .hostName").text("...");
                if (data) {
                    vlcPlaybackState = JSON.parse(JSON.stringify(data));
                    vlcPlaybackState.rate = vlcPlaybackState.rate || 1;

                    getUserName(data.host).then(name => {
                        $("#sessionStatusBar .hostName").text(name || "N/A");
                    });

                    if (data.host == firebase.auth().currentUser.uid) {
                        setNavVisibility("infoEditNav", true, "statusAND");
                        $("#hostNav").html(`<i class="material-icons">sync_disabled</i> <span class="label">Give up control</span>`);
                        $('#syncControlsArea .hostControls').show();
                        $('#syncControlsArea .clientControls').hide();
                        vlcPlaybackState.host = true;
                    } else {
                        $("#hostNav").html(`<i class="material-icons">settings_remote</i> <span class="label">Take control</span>`);
                        $('#syncControlsArea .hostControls').hide();
                        $('#syncControlsArea .clientControls').show();
                        vlcPlaybackState.host = false;
                    }
                } else {
                    $("#hostNav").html(`<i class="material-icons">settings_remote</i> <span class="label">Take control</span>`);
                    $('#syncControlsArea .hostControls').hide();
                    $('#syncControlsArea .clientControls').show();
                    vlcPlaybackState = { host: false };
                }

                if (data && data.resetOffset) {
                    offset = Infinity;
                    runs = 0;
                    calcOffset().then(() => {
                        forceVLCSkip = true;
                        if (firebase.auth().currentUser.uid == data.host) {
                            firebase.database().ref("/session/" + id + "/status/resetOffset").remove();
                        }
                    });
                }

                if ((!data || !data.video || !data.state) && (!data ? false : data.host == firebase.auth().currentUser.uid)) {
                    $("#sessionStatusBar").hide();

                    //Set status
                    $("#syncStatus span").text("Open a file");
                    $("#sessionNavStatus span").text("Open a file");
                    $("#syncDetails").text("To begin syncing playback to this session, open a video file in VLC");
                    $("#syncStatus i, #sessionNavStatus i").text("insert_drive_file");
                    playerResolved();
                    setUserStatus("openAFile");
                    if (fluid.get("pref-discordSync") == "true") ipcRenderer.send("discord-activity", {});
                    $('#syncControlsArea').hide();
                } else if ((!data || !data.video || !data.state) && groupInfo.scheduledStart) {
                    $("#sessionStatusBar").hide();

                    //Set status
                    $("#syncStatus span").text("Scheduled");
                    $("#sessionNavStatus span").text("Scheduled");
                    $("#syncDetails").text("This session is scheduled to start " + moment(groupInfo.scheduledStart).calendar());
                    $("#syncStatus i, #sessionNavStatus i").text("schedule");
                    playerResolved();
                    setUserStatus("sessionScheduled");
                    if (fluid.get("pref-discordSync") == "true") ipcRenderer.send("discord-activity", {});
                    $('#syncControlsArea').hide();
                } else if (!data || !data.video || !data.state) {
                    $("#sessionStatusBar").hide();

                    //Set status
                    $("#syncStatus span").text("Waiting for controller");
                    $("#sessionNavStatus span").text("Waiting");
                    $("#syncDetails").text("The controller of this session hasn't selected a video to sync yet");
                    $("#syncStatus i, #sessionNavStatus i").text("hourglass_empty");
                    playerResolved();
                    setUserStatus("waitingForHost");
                    if (fluid.get("pref-discordSync") == "true") ipcRenderer.send("discord-activity", {});
                    $('#syncControlsArea').hide();
                } else {
                    //Set status bar
                    if (groupInfo.contentID && richContent && data.episode) {
                        var url = richContent.url + "/episode/" + Number(data.episode.split("E")[1]);
                        $("#sessionStatusBar .videoName").html(`<a onclick="shell.openExternal('${url}')" href="#">${data.episode}</a>`);
                    } else if (data.episode) {
                        $("#sessionStatusBar .videoName").text(data.episode);
                    } else {
                        $("#sessionStatusBar .videoName").text(data.video);
                    }
                    $("#sessionStatusBar").show();

                    if (data.host == firebase.auth().currentUser.uid) {
                        //Set status
                        $("#syncStatus span").text("Syncing playback");
                        $("#sessionNavStatus span").text("Syncing");
                        $("#syncDetails").text("The playback state of video you're playing in VLC is syncing to the viewers of this session");
                        $("#syncStatus i, #sessionNavStatus i").text("sync");
                        setUserStatus("hosting");
                        $('#syncControlsArea').show();
                    } else if (file && file.endsWith(data.video)) {
                        $('#syncControlsArea').hide();
                        showPlayer(data);
                    } else {
                        $('#syncControlsArea').hide();
                        scanForVideos(data.video, function (files) {
                            //Check for file overrides
                            if (fileOverrides[data.video] && fs.existsSync(fileOverrides[data.video])) {
                                files = [fileOverrides[data.video]];
                            }

                            if (files.length == 1) {
                                file = files[0];

                                //Video downloaded
                                showPlayer(data);
                            } else if (!files.length && data.download) {
                                //Video needs to be downloaded
                                file = null;
                                playerActionNeeded("Download video", [
                                    `<p>This session has provided a download link for the video. <a onclick="shell.openExternal('${data.download}')" href="#">Click here</a> to open that link.</p>`,
                                    `<p>When the video has downloaded, copy it, without renaming, in your videos folder at <a onclick="shell.openPath('${VIDEO_FOLDER.replace(/\\/g, "\\\\")}')" href="#" class="videoFolderPath">${VIDEO_FOLDER}</a>. If you want to keep it somewhere else, change your videos folder location in settings.</p>`,
                                    `<p>Once the video is in your videos folder, click the button below to begin watching.</p>`
                                ].join(""), [
                                    {
                                        text: "Done",
                                        action: () => showPlayer(data)
                                    },
                                    {
                                        text: "Manually open file",
                                        action: () => addFileOverride(data)
                                    }
                                ]);
                                setUserStatus("downloadFile");
                            } else if (!files.length && !data.download) {
                                //Video not found
                                file = null;
                                playerActionNeeded("Cannot find file", [
                                    `<p>Red was unable to find the video file "${data.video}" in your videos folder at <a onclick="shell.openPath('${VIDEO_FOLDER.replace(/\\/g, "\\\\")}')" href="#" class="videoFolderPath">${VIDEO_FOLDER}</a>. Make sure you have the video in the correct folder and try again.</p>`,
                                    `<p>If the video file is in a different folder, change your videos folder location in settings. If you do not have the video file, try asking the controller of this session for more information. You might not be able to participate in this session.</p>`
                                ].join(""), [
                                    {
                                        text: "Try again",
                                        action: () => showPlayer(data)
                                    },
                                    {
                                        text: "Manually open file",
                                        action: () => addFileOverride(data)
                                    }
                                ]);
                                setUserStatus("cannotLocateFile");
                            } else if (files.length > 1) {
                                file = null;
                                playerActionNeeded("File name conflict", [
                                    `<p>Multiple files with the name "${data.video}" were found. Make sure you aren't renaming the file(s) and that the file names in your videos folder and subfolders are unique.</p>`,
                                ].join(""), [
                                    {
                                        text: "Try again",
                                        action: () => showPlayer(data)
                                    },
                                    {
                                        text: "Manually open file",
                                        action: () => addFileOverride(data)
                                    }
                                ]);
                                setUserStatus("fileConflict");
                            }
                        });
                    }
                }
            });

            //Add viewer count listener
            var viewerDB = firebase.database().ref("/session/" + id + "/viewers");
            sessionDB.push(viewerDB);
            viewerDB.on('value', snap => {
                var data = snap.val();
                sessionDBCache.viewers = data;

                $("#sessionStatusBar .viewCount").text(data || 0);
            });

            //Add member listener
            var memberDB = firebase.database().ref("/session/" + id + "/members");
            sessionDB.push(memberDB);
            memberDB.on('value', snap => {
                var data = snap.val();

                if (!data) {
                    $("#viewerListCard").hide();
                    return;
                }

                var html = "";
                var promises = [];
                Object.keys(data).forEach(uid => {
                    promises.push(new Promise((resolve, reject) => {
                        getUserName(uid).then(username => {
                            var icon = "person";
                            if (data[uid].toLowerCase().includes("file")) icon = "insert_drive_file"
                            if (data[uid].toLowerCase().includes("download")) icon = "file_download"
                            if ((data[uid] == "hosting") || (data[uid] == "openAFile")) icon = "settings_remote"
                            if (data[uid] == "syncing") icon = "play_circle_filled"
                            if (data[uid].toLowerCase().includes("waiting") || (data[uid] == "sessionScheduled")) icon = "hourglass_empty"
                            html += `<p><i class="material-icons">${icon}</i> ${username}</p>`;
                            resolve();
                        })
                    }))
                })

                Promise.all(promises).then(() => {
                    $("#viewerList").html(html);
                    $("#viewerListCard").show();
                })
            });

            //Add perm listener
            var permDB = firebase.database().ref("/session/" + id + "/perms");
            sessionDB.push(permDB);
            permDB.on('value', snap => {
                var data = snap.val();
                sessionDBCache.perms = data;

                //Reset session perms
                setNavVisibility(null, false, "perms");
                setNavVisibility(null, false, "permsAND");

                if (data) {
                    $("#scheduledSessionStart").show();
                } else {
                    $("#scheduledSessionStart").hide();
                }

                if (!data) {
                    //noPerms
                    setNavVisibility("hostNav", true, "perms");
                    setNavVisibility("infoEditNav", true, "permsAND");
                } else if ((data.owner == firebase.auth().currentUser.uid) || (isGlobalAdmin && (fluid.get('pref-adminInvestigation') == "true"))) {
                    //owner
                    setNavVisibility("hostNav", true, "perms");
                    setNavVisibility("infoEditNav", true, "perms");
                    setNavVisibility("permsEditnav", true, "perms");

                    //Perm edit UI
                    $("#sessionVisibilitySetting .btn").removeClass("active");
                    if (data.private) {
                        $("#sessionVisibilitySetting .private").addClass("active");
                    } else if (!data.listed) {
                        $("#sessionVisibilitySetting .unlisted").addClass("active");
                    } else {
                        $("#sessionVisibilitySetting .public").addClass("active");
                    }

                    if (data.anyHost) {
                        $("#hostLockSetting").addClass("active");
                    } else {
                        $("#hostLockSetting").removeClass("active");
                    }

                    //Session URL
                    if (data.accessCode) {
                        $("#sessionAccessURL").html(id + (data.accessCode ? "/" + data.accessCode : ""));
                        $("#sessionJoinCode").show();
                    } else {
                        $("#sessionJoinCode").hide();
                    }
                } else {
                    //Host perm
                    if (data.anyHost) {
                        setNavVisibility("hostNav", true, "perms");
                    }
                }
            });

            //Add role listener
            var roleDB = firebase.database().ref("/session/" + id + "/roles/" + firebase.auth().currentUser.uid);
            sessionDB.push(roleDB);
            roleDB.on('value', snap => {
                var data = snap.val();
                sessionDBCache.role = data;

                //Reset role perms
                setNavVisibility(null, false, "role");

                //Admin role
                if (data == "admin") {
                    setNavVisibility("infoEditNav", true, "role");
                    setNavVisibility("hostNav", true, "role");
                }
            });

            //Add owner role listener
            var ownerRoleDB = firebase.database().ref("/session/" + id + "/roles/");
            sessionDB.push(ownerRoleDB);
            ownerRoleDB.on('value', snap => {
                var data = snap.val();

                $("#adminUsersList").html("");
                $("#membersUserList").html("");

                Object.keys(data).forEach(uid => {
                    var role = data[uid];
                    getUserName(uid).then(data => {
                        if (role == "admin") {
                            $("#adminUsersList").append(`<p>${data} (<a onclick="removeRole('${uid}')" href="#">remove</a>)</p>`)
                        } else if (role == "member") {
                            $("#membersUserList").append(`<p>${data} (<a onclick="removeRole('${uid}')" href="#">remove</a>)</p>`)
                        }
                    });
                });
            });
        }
    }).catch(e => {
        if (e.code == "PERMISSION_DENIED") {
            if (isGlobalAdmin) {
                window.alert("Joining session with super sneaky mode");
                fluid.set("pref-adminStealth", true);
                joinSession(id, accessCode);
            } else {
                window.alert("You don't have permission to join the selected session");
            }
        } else {
            window.alert("Unable to join the selected session");
        }

        if (!isGlobalAdmin) leaveSession();
    });
}

function showPlayer(data) {
    if (data.video && file) {
        //Ready to show player
        playerResolved();
        setUserStatus("syncing");
        $('#syncControlsArea').show();

        if (data.state == "pause|0") {
            //Set status
            $("#syncStatus span").text("Ready to play");
            $("#sessionNavStatus span").text("Ready");
            $("#syncDetails").text("The controller is waiting for everyone else to get ready. Video playback will begin automatically.");
            $("#syncStatus i, #sessionNavStatus i").text("hourglass_full");
        } else {
            //Load video player
            if (data.state.startsWith("play|")) {
                //Set status
                $("#syncStatus span").text("Playing video");
                $("#sessionNavStatus span").text("Playing");
                $("#syncDetails").text("The video is playing in VLC");
                $("#syncStatus i, #sessionNavStatus i").text("play_arrow");
            } else if (data.state.startsWith("pause|")) {
                //Set status
                $("#syncStatus span").text("Video paused");
                $("#sessionNavStatus span").text("Paused");
                $("#syncDetails").text("The controller of this session has paused the video");
                $("#syncStatus i, #sessionNavStatus i").text("pause");
            }
        }
    } else if (data.video && !file) {
        //Try scanning for files again
        if (fileOverrides[data.video] && fs.existsSync(fileOverrides[data.video])) {
            file = fileOverrides[data.video];
            showPlayer(data);
        } else {
            scanForVideos(data.video, function (files) {
                if (files.length == 1) {
                    file = files[0];
                    showPlayer(data);
                } else if (files.length == 0) {
                    file = null;
                    alert("The file was not found in your videos folder. Make sure you followed all of the steps correctly and try again.");
                } else if (files.length > 1) {
                    file = null;
                    alert(`Multiple files with the name "${data.video}" were found. Make sure you aren't renaming the file(s) and that the file names in your videos folder are unique.`);
                }
            });
        }
    }
}


//StackOverflow stuff
function makeID(length) {
    var result = '';
    var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var charactersLength = characters.length;
    for (var i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}

function minutesAndSeconds(millis) {
    var minutes = Math.floor(millis / 60000);
    var seconds = ((millis % 60000) / 1000).toFixed(0);
    return minutes + ":" + (seconds < 10 ? '0' : '') + seconds;
}

function leaveSession() {
    //Clear any existing session data
    window.localStorage.removeItem("activeSession");
    sessionDB.forEach(db => {
        if (db.off) db.off();
    });
    sessionDB = [];
    sessionDBCache = {};
    dbConnection = false;
    firebase.database().ref("/session/" + mySessionID + "/members/" + firebase.auth().currentUser.uid).remove();
    mySessionID = null;
    navVisibility = {
        infoEditNav: {},
        permsEditnav: {},
        hostNav: {}
    };

    //Reload and show sessions list
    load("Getting sessions...");
    getSessions(true).then(() => {
        doneLoading();
        sessionScreen("list")
    });
}

function getSessions(list) {
    return new Promise((resolve, reject) => {
        firebase.database().ref("/sessionList").once("value").then(snap => {
            var sessionIDs = Object.keys(snap.val());

            if (!list) {
                resolve(sessionIDs);
                return;
            }

            var sessionInfoPromises = [];
            var sessionListHTML = "", sessionCopied = "";

            var copiedID, copiedAccess;
            var clipText = clipboard.readText() && clipboard.readText().trim();
            if (clipText && clipText.includes("/")) {
                copiedID = clipText.split("/")[0];
                copiedAccess = clipText.split("/")[1];
            }

            sessionIDs.forEach(id => {
                sessionInfoPromises.push(new Promise((resolve, reject) => {
                    var sessionInfo;
                    firebase.database().ref("/session/" + id + "/info").once("value").then(snap => {
                        sessionInfo = snap.val();
                        return firebase.database().ref("/session/" + id + "/viewers").once("value");
                    }).then((snap) => {
                        var viewers = snap.val();
                        if (sessionInfo) {
                            sessionListHTML += `
                                <div onclick="joinSession('${id}')" class="card session">
                                    <h5>${sessionInfo.name}</h5>
                                    <div class="details">
                                        <div>
                                            <i class="material-icons">visibility</i>
                                            <span>${viewers || 0} viewers</span>
                                        </div>
                                        ${sessionInfo.content ? `
                                            <div>
                                                <i class="material-icons">movie</i>
                                                <span>${sessionInfo.content}</span>
                                            </div>
                                        ` : ``}
                                        ${sessionInfo.scheduledStart ? `
                                            <div>
                                                <i class="material-icons">schedule</i>
                                                <span>Scheduled to start ${moment(sessionInfo.scheduledStart).calendar()}</span>
                                            </div>
                                        ` : ``}
                                    </div>
                                </div>
                            `;
                        }
                        resolve();
                    }).catch(e => {
                        if (id == copiedID) {
                            sessionCopied = `
                                <div onclick="joinSession('${id}', '${copiedAccess}')" class="card session unlisted">
                                    <h5>Unlisted session (from clipboard)</h5>
                                    <div class="details">
                                        <div>
                                            <i class="material-icons">visibility_off</i>
                                            <span>Click here to try joining the unlisted session you copied</span>
                                        </div>
                                    </div>
                                </div>
                            `;
                        }
                        resolve();
                    });
                }))
            })

            //Get info for all listed sessions
            Promise.all(sessionInfoPromises).then(() => {
                $("#sessionsList").html(sessionCopied + sessionListHTML);
                resolve(sessionIDs)
            });
        })
    })
}

function setUserStatus(status) {
    userStatus = status;

    if (dbConnection && mySessionID && !(isGlobalAdmin && (fluid.get("pref-adminStealth") == "true"))) {
        firebase.database().ref("/session/" + mySessionID + "/members/" + firebase.auth().currentUser.uid).set(userStatus);
    }
}

function getUserName(uid) {
    return new Promise((resolve, reject) => {
        if (isGlobalAdmin && (fluid.get("pref-adminDebug") == "true")) {
            resolve(uid);
        } else if (namesCache[uid]) {
            resolve(namesCache[uid]);
        } else {
            firebase.database().ref("/users/username/" + uid).once("value").then(snap => {
                var name = snap.val();

                namesCache[uid] = name;
                resolve(name || "Guest");
            }).catch(e => {
                reject(e);
            });
        }
    })
}

var results = [];
function scanForVideos(video, cb, folder = VIDEO_FOLDER) {
    if (folder == VIDEO_FOLDER) results = [];

    try {
        fs.readdirSync(folder).forEach(file => {
            try {
                if (fs.lstatSync(path.join(folder, file)).isDirectory()) {
                    scanForVideos(video, undefined, path.join(folder, file));
                } else if (file == video) {
                    results.push(path.join(folder, file));
                }
            } catch (e) { }
        });
    } catch (e) { }

    if (cb) cb(results);
}