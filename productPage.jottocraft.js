(window.s || (window.s = [])).push({
    site: "red.jottocraft.com",
    name: "Red (beta)",
    description: "Sync ~full-quality~ local VLC playback between devices.",
    productImage: "/assets/productImage.png",
    colors: { brand: "#EF4444", brandDark: "#DC2626" },
    copyright: "(c) jottocraft 2020-2021. [source code](https://github.com/jottocraft/red) / [license](https://github.com/jottocraft/red/blob/master/LICENSE)",
    links: [
        { name: "Download", type: "main", icon: "file_download", href: "https://update.red.jottocraft.com/download" },
        { name: "Source Code", icon: "code", href: "https://github.com/jottocraft/red", newWindow: true }
    ],
    sections: [
        {
            type: "split",
            left: {
                image: "/assets/playback.svg",
                icon: "sync",
                title: "Synced Playback",
                text: "Red syncs the video file information, timestamp, and selected video, audio, and subtitle tracks."
            }, right: {
                image: "/assets/media.svg",
                icon: "insert_drive_file",
                title: "Local Files",
                text: "Red syncs local video file playback instead of video streaming for high-quality and low-latency syncing."
            }
        }
    ]
});