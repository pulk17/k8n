package handlers

import (
	"encoding/json"
	"fmt"
)

// The canvas models the fields people draw with, not every field Kubernetes
// has. An imported manifest would otherwise come back without its probes, env,
// init containers, network rules and the rest. So at import each object is
// compiled straight back, and whatever did not survive is kept on the node as
// {path, value} pairs; compiling puts them back. Only what the canvas lost is
// kept, so what it does model (fields, edges) stays editable.
const preservedKey = "preserved"

// Set by the cluster, not by whoever wrote the manifest.
var serverSet = map[string]bool{
	"uid": true, "resourceVersion": true, "generation": true, "creationTimestamp": true,
	"managedFields": true, "selfLink": true, "namespace": true, "name": true,
}

// lostParts returns what compiled lacks of source, as {path, value} pairs.
func lostParts(source, compiled map[string]interface{}) []interface{} {
	var out []interface{}
	var walk func(src, got interface{}, path []interface{})
	walk = func(src, got interface{}, path []interface{}) {
		keep := func() {
			out = append(out, map[string]interface{}{"path": append([]interface{}{}, path...), "value": src})
		}
		switch s := src.(type) {
		case map[string]interface{}:
			g, ok := got.(map[string]interface{})
			if !ok {
				keep()
				return
			}
			for k, v := range s {
				if len(path) == 0 && k == "status" || len(path) == 1 && path[0] == "metadata" && serverSet[k] {
					continue
				}
				if gv, ok := g[k]; ok {
					walk(v, gv, append(path, k))
				} else {
					walk(v, nil, append(path, k))
				}
			}
		case []interface{}:
			g, ok := got.([]interface{})
			if !ok || !listOfMaps(s) {
				if fmt.Sprint(src) != fmt.Sprint(got) {
					keep()
				}
				return
			}
			// Lists of objects (containers, ports, volumes) line up by index,
			// so one lost field does not freeze the whole list.
			for i, v := range s {
				if i < len(g) {
					walk(v, g[i], append(path, float64(i)))
				} else {
					walk(v, nil, append(path, float64(i)))
				}
			}
		default:
			if got == nil || fmt.Sprint(src) != fmt.Sprint(got) {
				keep()
			}
		}
	}
	walk(generic(source), generic(compiled), nil)
	return out
}

func listOfMaps(l []interface{}) bool {
	for _, v := range l {
		if _, ok := v.(map[string]interface{}); !ok {
			return false
		}
	}
	return len(l) > 0
}

// restoreParts puts the kept parts back into a freshly compiled object. A part
// inside a list item the canvas no longer has (its edge was removed) is dropped
// with it rather than recreated half-empty.
func restoreParts(obj map[string]interface{}, parts []interface{}) map[string]interface{} {
	out, _ := generic(obj).(map[string]interface{})
	for _, p := range parts {
		part, _ := p.(map[string]interface{})
		path, _ := part["path"].([]interface{})
		if len(path) == 0 {
			continue
		}
		if v, ok := put(out, path, part["value"]); ok {
			out = v.(map[string]interface{})
		}
	}
	return out
}

func put(cur interface{}, path []interface{}, v interface{}) (interface{}, bool) {
	if len(path) == 0 {
		return v, true
	}
	switch seg := path[0].(type) {
	case string:
		m, ok := cur.(map[string]interface{})
		if !ok {
			if cur != nil {
				return cur, false
			}
			m = map[string]interface{}{}
		}
		child, ok := put(m[seg], path[1:], v)
		if !ok {
			return cur, false
		}
		m[seg] = child
		return m, true
	default:
		i, ok := index(seg)
		l, isList := cur.([]interface{})
		if !ok || (!isList && cur != nil) {
			return cur, false
		}
		switch {
		case len(path) == 1 && i == len(l):
			return append(l, v), true
		case i >= len(l):
			return cur, false
		}
		child, ok := put(l[i], path[1:], v)
		if !ok {
			return cur, false
		}
		l[i] = child
		return l, true
	}
}

func index(seg interface{}) (int, bool) {
	switch n := seg.(type) {
	case float64:
		return int(n), true
	case int:
		return n, true
	case int64:
		return int(n), true
	}
	return 0, false
}

// generic turns typed slices and maps into the JSON shapes the walk expects.
func generic(v interface{}) interface{} {
	b, err := json.Marshal(v)
	if err != nil {
		return v
	}
	var out interface{}
	if json.Unmarshal(b, &out) != nil {
		return v
	}
	return out
}
