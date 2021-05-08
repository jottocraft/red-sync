--[==========================================================================[
 jottocraft.lua: Code for processing red / VLC sync integration commands
--[==========================================================================[
 Copyright (c) 2007-2021 the VideoLAN team and jottocraft
 Licenced under the GNU General Public License v2.0 (https://github.com/jottocraft/red/blob/master/LICENSE)

 Authors: jottocraft <hello@jottocraft.com>
 Antoine Cellerier <dionoea at videolan dot org>
 Rob Jonson <rob at hobbyistsoftware.com>
--]==========================================================================]

module("jottocraft", package.seeall)

local common = require("common")
local dkjson = require("dkjson")

processcommands = function ()
    local input = _GET['input']
    local command = _GET['command']
    local val = _GET['val']
	local base = _GET['base']
    local options = _GET['option']
    local name = _GET['name']
    local duration = tonumber(_GET['duration'])

    if type(options) ~= "table" then -- Deal with the 0 or 1 option case
        options = { options }
    end

    if command == "playitem" then
        vlc.playlist.add({{path=vlc.strings.make_uri(input),options=options,name=name,duration=duration}})
    elseif command == "play" then
        if vlc.playlist.status() == "paused" then
            vlc.playlist.pause()
        end
    elseif command == "pause" then
        if vlc.playlist.status() == "playing" then
            vlc.playlist.pause()
        end
    elseif command == "stop" then
        vlc.playlist.stop()
    elseif command == "commonseek" then
        common.seek(val)
	elseif command == "playerseek" then
        vlc.player.seek_by_time_absolute(val * 1000000) 
    elseif command == "debug" then
        vlc.osd.message("Debug message")
    elseif command == "rate" then
        vlc.player.set_rate(val)
    elseif command == "audio_track" then
        vlc.player.toggle_audio_track(val)
    elseif command == "video_track" then
        vlc.player.toggle_video_track(val)
    elseif command == "spu_track" then
        vlc.player.toggle_spu_track(val)
    elseif command == "quit" then
        vlc.misc.quit()
    end

    local input = nil
    local command = nil
    local val = nil
end

--dkjson outputs numbered tables as arrays
--so we don't need the array indicators
function removeArrayIndicators(dict)
    local newDict=dict

    for k,v in pairs(dict) do
        if (type(v)=="table") then
            local arrayEntry=v._array
            if arrayEntry then
                v=arrayEntry
            end

            dict[k]=removeArrayIndicators(v)
        end
    end

    return newDict
end

printTableAsJson = function (dict)
    dict=removeArrayIndicators(dict)

    local output=dkjson.encode (dict, { indent = true })
    print(output)
end

getstatus = function ()

    local item = vlc.player.item()
    local playlist = vlc.object.playlist()

    local res = {}

    res.jottocraft=200
    res.version=vlc.misc.version()

    res.state = vlc.playlist.status()
    res.rate = vlc.player.get_rate()
    res.playing = vlc.player.is_playing()

    if item then
        res.time = vlc.player.get_time() / 1000000
        res.length = item:duration()
        res.name = item:name()
        res.metas = item:metas()

        res.tracks = {}
        res.tracks.video = vlc.player.get_video_tracks()
        res.tracks.audio = vlc.player.get_audio_tracks()
        res.tracks.spu = vlc.player.get_spu_tracks()
    end

    return res
end

