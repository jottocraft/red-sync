--[==========================================================================[
 jottocraft.lua: code for processing VLC sync integration commands
--[==========================================================================[
 Copyright (C) 2020 jottocraft
 $Id$

 Authors: jottocraft <hello@jottocraft.com>
--]==========================================================================]

module("jottocraft",package.seeall)

local common = require ("common")
local dkjson = require ("dkjson")


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
    elseif command == "addsubtitle" then
        vlc.input.add_subtitle (val)
    elseif command == "commonseek" then
        common.seek(val)
	elseif command == "directseek" then
        vlc.var.set(vlc.object.input(),"time", val * 1000000)
	elseif command == "offsetseek" then
        vlc.var.set(vlc.object.input(),"time", (val + (os.time() - base)) * 1000000)
    elseif command == "key" then
        common.hotkey("key-"..val)
    elseif command == "rate" then
        vlc.var.set(vlc.object.input(),"rate", val)
    elseif command == "audio_track" then
        vlc.var.set(vlc.object.input(), "audio-es", val)
    elseif command == "video_track" then
        vlc.var.set(vlc.object.input(), "video-es", val)
    elseif command == "spu_track" then
        vlc.var.set(vlc.object.input(), "spu-es", val)
    elseif command == "quit" then
        vlc.misc.quit()
    end

    local input = nil
    local command = nil
    local val = nil

end

--utilities for formatting output

function xmlString(s)
    if (type(s)=="string") then
        return vlc.strings.convert_xml_special_chars(s)
    elseif (type(s)=="number") then
        return common.us_tostring(s)
    else
        return tostring(s)
    end
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

getValueArray = function (o,var)
	local result = {}
	
	local current = vlc.var.get( o, var )
    local v, l = vlc.var.get_list( o, var )
	
	for i,val in ipairs(v) do
		local obj = {}
		obj.active = current == val
		obj.val = val
		obj.item = l[i]
        table.insert(result, obj)
    end
	
	return result
end

getstatus = function ()


    local input = vlc.object.input()
    local item = vlc.input.item()
    local playlist = vlc.object.playlist()

    local s ={}

    s.jottocraft=106
    s.version=vlc.misc.version()

    if input then
        s.time = vlc.var.get(input,"time") / 1000000
        s.position=vlc.var.get(input,"position")
        s.rate=vlc.var.get(input,"rate")
    end

    if item then
        s.length=item:duration()
    end

    s.state=vlc.playlist.status()

    if (item) then
        s.information={}
		
		s.information.tracks = {}

		s.information.tracks.spu = getValueArray(vlc.object.input(), "spu-es")
		s.information.tracks.audio = getValueArray(vlc.object.input(), "audio-es")
		s.information.tracks.video = getValueArray(vlc.object.input(), "video-es")
			
        s.information.meta=item:metas()
    end
    return s
end

