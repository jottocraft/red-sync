//Files
function moveVideoFolder(cb) {
    dialog.showOpenDialog({
        title: "Change videos folder location",
        buttonLabel: "Set videos folder",
        properties: ['openDirectory']
    }).then(function (results) {
        if (!results.canceled) {
            VIDEO_FOLDER = results.filePaths[0];
            $(".videoFolderPath").text(VIDEO_FOLDER);
            $(".videoFolderPath").attr("onclick", "shell.openPath('" + VIDEO_FOLDER.replace(/\\/g, "\\\\") + "')");
            window.localStorage.videoFolderPath = VIDEO_FOLDER;
            if (cb) cb();
        }
    });
}

function addFileOverride(data) {
    var ext = data.video.split(".").pop();
    dialog.showOpenDialog({
        title: "Manually open video file",
        buttonLabel: "Open video file",
        properties: ['openFile'],
        filters: [{ name: ext.toUpperCase() + ' File', extensions: [ext] }]
    }).then(function (results) {
        if (!results.canceled) {
            fileOverrides[data.video] = results.filePaths[0];
            window.localStorage.setItem("fileOverrides", JSON.stringify(fileOverrides));
            showPlayer(data);
        }
    });
}

function setVLCPath() {
    dialog.showOpenDialog({
        title: "Set VLC location",
        buttonLabel: "Set VLC location",
        properties: ['openFile'],
        filters: [{ name: 'EXE File', extensions: ['exe'] }]
    }).then(function (results) {
        if (!results.canceled) {
            window.localStorage.vlcExePath = results.filePaths[0];
            VLC_EXE = window.localStorage.vlcExePath;
            $(".vlcProgramPath").text(VLC_EXE);
            $(".vlcProgramPath").attr("onclick", "shell.showItemInFolder('" + VLC_EXE.replace(/\\/g, "\\\\") + "')");
        }
    });
}

//MAL integration
var malState = "off", malTimeout;
function malUI(state, title) {
    malState = state;
    if (state == "off") {
        $("#malLinked").hide();
        $("#malSection").hide();
        $("#malLink").removeClass("active");
        $("#sessionContentName").prop("disabled", false);
    } else if (state == "list") {
        $("#malLinked").hide();
        $("#malSection").show();
        $("#malLink").addClass("active");
        $("#sessionContentName").prop("disabled", false);
        if ($("#sessionContentName").val()) updateMalList();
    } else if (typeof state == "number") {
        firebase.database().ref("/session/" + mySessionID + "/info/contentID").remove().then(() => {
            return firebase.database().ref("/session/" + mySessionID + "/info/content").set(title)
        }).then(() => {
            return firebase.database().ref("/session/" + mySessionID + "/info/contentID").set("mal." + state);
        });
    } else if (state.title) {
        $("#malLinkedName").text(state.title);
        $("#malLinkedName").attr("onclick", "shell.openExternal('" + state.url + "')");
        $("#malLinked").show();
        $("#malSection").hide();
        $("#malLink").addClass("active");
        $("#sessionContentName").prop("disabled", true);
    }
}

function updateMalList() {
    var html = "";
    $("#animeList").html("<p>Getting results...</p>");
    $.getJSON("https://api.jikan.moe/v3/search/anime?q=" + encodeURI($("#sessionContentName").val()), function (data) {
        data.results.forEach(item => {
            html += `
                <div onclick="malUI(${item.mal_id}, '${item.title}')">
                    <h5>${item.title}</h5>
                    <p>${item.type || ""} ${item.start_date ? `(${new Date(item.start_date).getFullYear()}) ` : ""}${item.episodes ? " - " + item.episodes + " episodes" : ""} </p>
                </div>
            `;
        });

        $("#animeList").html(html);
    });
}

$(document).ready(() => {
    $("#sessionContentName").on("keyup", (e) => {
        clearTimeout(malTimeout);
        if ($("#sessionContentName").val() && (malState == "list")) {
            malTimeout = setTimeout(updateMalList, 1000);
        }
    });

    $("#malLink").on("click", function () {
        $("#malLink").toggleClass("active");

        if ($("#malLink").hasClass("active")) {
            malUI("list");
        } else {
            firebase.database().ref("/session/" + mySessionID + "/info/contentID").remove();
        }
    })
})

//SYNC CONTROLS
function resetSessionOffset() {
    firebase.database().ref("/session/" + mySessionID + "/status/resetOffset").set(true);
}

//CREATE SESSION
function createSession() {
    var newName = $("#newSessionName").val();
    if (!newName) return alert("You must set a session name");

    var newSession = firebase.database().ref("/session").push();

    if (firebase.auth().currentUser.isAnonymous) {
        //Create session anonymously
        newSession.set({
            info: {
                name: newName
            },
            status: {
                host: firebase.auth().currentUser.uid
            }
        }).then(() => {
            return firebase.database().ref("/sessionList/" + newSession.getKey()).set(newSession.getKey());
        }).then(() => {
            //return to session list
            getSessions(true);
            sessionScreen("list");
        });
    } else {
        //Create session with permissions
        newSession.set({
            info: {
                name: newName
            },
            status: {
                host: firebase.auth().currentUser.uid
            },
            perms: {
                owner: firebase.auth().currentUser.uid,
                private: true
            }
        }).then(() => {
            return firebase.database().ref("/sessionList/" + newSession.getKey()).set(newSession.getKey());
        }).then(() => {
            //return to session list
            getSessions(true);
            sessionScreen("list");
        });
    }
}

//TAKE CONTROL
function takeControl() {
    if (sessionDBCache.status && (sessionDBCache.status.host == firebase.auth().currentUser.uid)) {
        firebase.database().ref("/session/" + mySessionID + "/status").remove();
    } else {
        firebase.database().ref("/session/" + mySessionID + "/status/host").set(firebase.auth().currentUser.uid);
    }
}

//SESSION PERMS UI
function toggleHostLock(ele) {
    firebase.database().ref("/session/" + mySessionID + "/perms/anyHost").set(!sessionDBCache.perms.anyHost);
}

function sessionAccess(mode) {
    if (mode == "public") {
        sessionDBCache.perms.private = null;
        sessionDBCache.perms.listed = true;
        sessionDBCache.perms.accessCode = null;
    } else if (mode == "unlisted") {
        sessionDBCache.perms.private = null;
        sessionDBCache.perms.listed = null;
        sessionDBCache.perms.accessCode = makeID(6);
    } else if (mode == "private") {
        sessionDBCache.perms.private = true;
        sessionDBCache.perms.listed = null;
        sessionDBCache.perms.accessCode = null;
    }

    firebase.database().ref("/session/" + mySessionID + "/perms").set(sessionDBCache.perms);
}

function removeRole(uid) {
    firebase.database().ref("/session/" + mySessionID + "/roles/" + uid).remove();
}

function addRole(role) {
    var username = $("#addSessionRole").val();
    if (!username) return alert("Please enter a username to assign a role to");

    firebase.database().ref("/users/uid/" + username).once("value").then(snap => {
        var uid = snap.val();
        if (uid == firebase.auth().currentUser.uid) return alert("You cannot give yourself a role. Since you are the owner of the group, you already have full access.");
        if (!uid) {
            alert("The username you entered does not exist");
        } else {
            firebase.database().ref("/session/" + mySessionID + "/roles/" + uid).set(role);
            $("#addSessionRole").val("");
        }
    });
}

function deleteSession() {
    var id = mySessionID;
    if (confirm("Are you sure you want to delete this session? You cannot recover sessions after deleting them.")) {
        leaveSession();
        firebase.database().ref("/sessionList/" + id).remove().then(() => {
            return firebase.database().ref("/session/" + id).remove();
        }).then(() => {
            getSessions(true);
            sessionScreen("list");
        });
    }
}

//LOGOUT
function logout() {
    leaveSession();
    fluid.cards.close();
    firebase.auth().signOut();
}

//SESSION INFO UI
function saveSessionInfo() {
    if (!$("#sessionNameSetting").val()) return alert("Please enter a group name");

    sessionDBCache.info.name = $("#sessionNameSetting").val();
    sessionDBCache.info.scheduledStart = $("#sessionStartTime").val() ? new Date($("#sessionStartTime").val()).getTime() : null;
    sessionDBCache.info.content = $("#sessionContentName").val() || null;
    sessionDBCache.info.download = $("#sessionDownloadURL").val() || null;

    console.log(sessionDBCache);
    firebase.database().ref("/session/" + mySessionID + "/info").set(sessionDBCache.info);
}

//PLAYER ACTION NEEDED UI
function playerActionNeeded(title, desc, actions) {
    $("#sessionStatusAction h5").text(title);
    $("#sessionStatusAction p").html(desc);
    $("#sessionStatusAction div").html("");
    if (actions) {
        actions.forEach(action => {
            $("#sessionStatusAction div").append(`<button>${action.icon ? `<i class="material-icons">${action.icon}</i>` : ``}${action.text}</button>`)
            $("#sessionStatusAction div button:last-child").click(action.action);
        })
    }
    $("#sessionStatusAction").show();
    $("#sessionNavStatus span").text("Action needed");
    $("#sessionNavStatus i").text("warning");

    $("#sessionStatusHeader").hide();
}

function playerResolved() {
    $("#sessionStatusAction").hide();
    $("#sessionStatusHeader").show();
}

//ACTION NEEDED UI
function actionNeeded(title, desc, actions) {
    $("#actionAlert h5").text(title);
    $("#actionAlert p").text(desc);
    $("#actionAlert div").html("");
    if (actions) {
        actions.forEach(action => {
            $("#actionAlert div").append(`<button>${action.icon ? `<i class="material-icons">${action.icon}</i>` : ``}${action.text}</button>`)
            $("#actionAlert div button:last-child").click(action.action);
        })
    }
    sessionScreen("actionNeeded");
    doneLoading();
}

//LOADING SCREEN FUNCTIONS
function load(state) {
    $("#loading").show();
    $("#loadingState").html(state || "");
}

function doneLoading() {
    $("#loading").hide();
}

//LOGIN SCREEN FUNCTIONS ------------
function showLoginScreen() {
    $("#login").show();
    $(".loginScreen").hide();
    $("#mainLogin").show();
}

function hideLoginScreen() {
    $("#login").hide();
}

function emailPasswordUI() {
    $(".loginScreen").hide();
    $("#emailPasswordUI").show();
}

function githubUI() {
    $(".loginScreen").hide();
    $("#githubUI").show();
    $("#githubLoginButton").hide();
    $("#githubAuthCode").text("...");
    $("#githubLoginWaiting").hide();
    signInWithGithub().then((data) => {
        $("#githubAuthCode").text(data.code);
        $("#githubLoginButton").off('click');
        $("#githubLoginButton").click(() => {
            require("electron").remote.shell.openExternal(data.url);
            $("#githubLoginButton").hide();
            $("#githubLoginWaiting").show();
        });
        $("#githubLoginButton").show();
        data.poll().then((auth) => {
            var credential = firebase.auth.GithubAuthProvider.credential(auth.access_token);
            firebase.auth().signInWithCredential(credential).catch(err => {
                if (err.code == "auth/user-disabled") {
                    window.alert("Your account has been disabled. Please contact hello@jottocraft.com for more information.");
                } else {
                    window.alert("There was an error when trying to sign in with GitHub. Please try again later.");
                }
            });
        })
    });
}

function emailPasswordSignIn() {
    var email = $("#userEmail").val();
    var password = $("#userPassword").val();
    firebase.auth().signInWithEmailAndPassword(email, password).catch(err => {
        console.log(err);
        if (err.code == "auth/user-not-found") {
            createAccountUI();
        } else if (err.code == "auth/wrong-password") {
            window.alert("Invalid password");
        } else if (err.code == "auth/user-disabled") {
            window.alert("Your account has been disabled. Please contact hello@jottocraft.com for more information.");
        } else {
            window.alert("Sign in error: " + err.message);
        }
    });
}

function createEmailAccount() {
    var email = $("#userEmail").val();
    var password = $("#userPassword").val();
    var passwordConfirm = $("#userPasswordVerify").val();

    if (password !== passwordConfirm) {
        window.alert("The password you typed doesn't match. Try again.");
        return;
    }

    firebase.auth().createUserWithEmailAndPassword(email, password).catch(function (error) {
        console.error(error);
        window.alert("An error occurred when trying to create your account. Try again later.");
    });
}

function anonymousLogin() {
    firebase.auth().signInAnonymously().catch(function (error) {
        console.log(error);
    });
}

function createAccountUI() {
    $(".loginScreen").hide();
    $("#createAccountUI").show();
}

var nameUIcallback;
function setANameUI(callback) {
    nameUIcallback = callback;
    $(".loginScreen").hide();
    $("#setANameUI").show();
}

function setUsername() {
    var username = $("#newUsername").val();
    if (username && username.match(/^[A-Za-z0-9_-]*$/) && (username.length <= 20) && !username.toLowerCase().includes("jottocraft")) {
        firebase.database().ref("/users/uid/" + username).set(firebase.auth().currentUser.uid).then(() => {
            firebase.database().ref("/users/username/" + firebase.auth().currentUser.uid).set(username).then(() => {
                if (nameUIcallback) nameUIcallback();
            });
        }).catch(() => {
            alert("Unable to set username. It might already be taken. Try a different one.");
        });
    } else {
        alert("Your username must be less than 20 characters long and can only contain letters, numbers, and underscores");
    }
}

//NAVIGATION
var navVisibility = {
    infoEditNav: {},
    permsEditnav: {},
    hostNav: {}
};
function setNavVisibility(id, state, condition) {
    if (id == null) {
        //If id is null, set for all ids
        Object.keys(navVisibility).forEach(id => {
            navVisibility[id][condition] = state;

            var showThis = false;
            var andSection = null;
            Object.keys(navVisibility[id]).forEach(cond => {
                if (cond.endsWith("AND")) {
                    if (andSection == false) return;
                    andSection = navVisibility[id][cond];
                } else if (navVisibility[id][cond]) {
                    showThis = true;
                }
            });

            showThis = showThis || andSection;

            //Update nav visibility
            if (showThis) {
                $("#" + id).show();
            } else {
                $("#" + id).hide();
            }
        });

        return;
    }

    //Store condition
    if (!navVisibility[id]) navVisibility[id] = {};
    navVisibility[id][condition] = state;

    //Show nav if at least one condition is true
    var showThis = false;
    var andSection = null;
    Object.keys(navVisibility[id]).forEach(cond => {
        if (cond.endsWith("AND")) {
            if (andSection == false) return;
            andSection = navVisibility[id][cond];
        } else if (navVisibility[id][cond]) {
            showThis = true;
        }
    });

    showThis = showThis || andSection;

    //Update nav visibility
    if (showThis) {
        $("#" + id).show();
    } else {
        $("#" + id).hide();
    }
}

function settings() {
    $(".navbar .navitem").removeClass("active");
    $(".navbar .navitem.settings").addClass("active");
    $(".sidebar").hide();
    $(".container").hide();
    $(".container.settingsContainer").show();
    $("body").css("padding-left", "0px");

    $(".videoFolderPath").text(VIDEO_FOLDER);
    $(".vlcProgramPath").text(VLC_EXE);

    $(".videoFolderPath").attr("onclick", "shell.openPath('" + VIDEO_FOLDER.replace(/\\/g, "\\\\") + "')");
    $(".vlcProgramPath").attr("onclick", "shell.showItemInFolder('" + VLC_EXE.replace(/\\/g, "\\\\") + "')");

    if (Object.keys(fileOverrides).length) {
        $("#clearFileOverrides").show();
    } else {
        $("#clearFileOverrides").hide();
    }
}

function globalAdmin() {
    $(".navbar .navitem").removeClass("active");
    $(".navbar .navitem.globalAdmin").addClass("active");
    $(".sidebar").hide();
    $(".container").hide();
    $(".container.globalAdminContainer").show();
    $("body").css("padding-left", "0px");
}

var sessionScreenType = "session";
function sessionScreen(type) {
    if (type !== undefined) sessionScreenType = type;

    $(".navbar .navitem").removeClass("active");
    $(".navbar .navitem.session").addClass("active");
    $(".container").hide();

    if (sessionScreenType == "list") {
        $(".sidebar").hide();
        $(".container.sessionListContainer").show();
        $("body").css("padding-left", "0px");
        $("#sessionName").text("Sessions");
    } else if (sessionScreenType == "actionNeeded") {
        $(".sidebar").hide();
        $(".container.actionNeededContainer").show();
        $("body").css("padding-left", "0px");
    } else if (sessionScreenType == "create") {
        $(".sidebar").hide();
        $(".container.createSessionContainer").show();
        $("body").css("padding-left", "0px");
        $("#sessionName").text("Sessions");

        if (firebase.auth().currentUser.isAnonymous) {
            $("#createSessionPerms").hide();
            $("#createSessionNoPerms").show();
        } else {
            $("#createSessionPerms").show();
            $("#createSessionNoPerms").hide();
        }
    } else {
        $(".sidebar").show();
        $(".container.playbackContainer").show();
        $("body").css("padding-left", "");
    }
}

function navigate(id) {
    $(".screen").hide();
    $("#" + id).show();
}