const express = require("express");
const oauthServer = express();
var oauthIsListening = false, oauthListener;

oauthServer.get('/google/redirect', (req, res) => {
    //Send the hash to the server by replacing it with a query at /google/response
    res.send(`<script>window.location.replace("/google/response" + window.location.hash.replace("#", "?"));</script>`);
});

oauthServer.get('/google/response', (req, res) => {
    console.log(req.query);
    if (req.query.access_token) {
        var credential = firebase.auth.GoogleAuthProvider.credential(null, req.query.access_token);
        firebase.auth().signInWithCredential(credential).then(() => {
            res.send("You have been signed in to Red. You can now close this tab.");
        }).catch(function(error) {
            res.send(`<b>An error occured when trying to sign in to Red</b><br />` + error.message);
          });
    } else {
        res.send("An error occured in the sign in process.");
    }
});



function signInWithGoogle() {
    if (!oauthIsListening) {
        oauthListener = oauthServer.listen(9091, () => {
            console.log("Listening...");
            oauthIsListening = true;
            $("#openGoogleButton").show();
        });
    } else {
        $("#openGoogleButton").show();
    }
}

function openGoogleInBrowser() {
    shell.openExternal("https://accounts.google.com/o/oauth2/v2/auth?client_id=792787111903-ir0118c9fci2lj37sudn8qnvpgb3ta6d.apps.googleusercontent.com&redirect_uri=http://localhost:9091/google/redirect&response_type=token&scope=profile%20email");
}