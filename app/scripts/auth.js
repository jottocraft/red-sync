function signInWithGithub() {
    return new Promise((resolve, reject) => {
        $.ajax({
            url: "https://github.com/login/device/code?client_id=f67039ec3a42b83c3ad4&scope=read:user%20user:email",
            method: "POST",
            headers: {
                Accept: "application/json"
            },
            success: function (data) {
                resolve({
                    url: data.verification_uri,
                    code: data.user_code,
                    poll: function () {
                        return new Promise((resolve, reject) => {
                            var poll = function() {
                                $.ajax({
                                    url: "https://github.com/login/oauth/access_token?client_id=f67039ec3a42b83c3ad4&grant_type=urn:ietf:params:oauth:grant-type:device_code&device_code=" + data.device_code,
                                    method: "POST",
                                    headers: {
                                        Accept: "application/json"
                                    },
                                    success: function (auth) {
                                        if (!auth.error) {
                                            resolve(auth);
                                        } else {
                                            setTimeout(poll, 1000 + (data.interval * 1000));
                                        }
                                    }
                                });
                            }
                            poll();
                        })
                    }
                })
            }
        })
    })
}