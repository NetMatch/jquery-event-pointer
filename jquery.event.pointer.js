(function( factory ) {
	if ( typeof define === "function" && define.amd ) {
		// AMD. Register as an anonymous module.
		define([ "jquery" ], factory );
	} else if ( typeof exports === "object" ) {
		// Node/CommonJS style for Browserify
		module.exports = factory;
	} else {
		// Browser globals
		factory( jQuery );
	}
}( function ( jQuery ) {

	"use strict";

	var POINTER_PROPS = "screenX screenY clientX clientY ctrlKey shiftKey altKey metaKey relatedTarget detail button buttons pointerId pointerType width height pressure tiltX tiltY isPrimary".split( " " );

	// https://dvcs.w3.org/hg/pointerevents/raw-file/tip/pointerEvents.html#dfn-chorded-buttons
	var BUTTONS_MAP = {
		0 : 1,
		1 : 4,
		2 : 2
	};

	// The actual "pointerenter" and "pointerleave" events are non-bubbling. We want them to have bubbling
	// to mirror jQuery's "mouseenter" and "mouseleave" support, so we base these events on the bubbling
	// "pointerover" and "pointerout" events instead, mimicing the logic for the pair of mouse events.
	jQuery.each({
		"pointerenter" : "pointerover",
		"pointerleave" : "pointerout"
	}, function( original, fix ) {
		jQuery.event.special[ original ] = {
			bindType     : fix,
			delegateType : fix,
			handle       : function( event ) {
				var
					target    = this,
					related   = event.relatedTarget,
					handleObj = event.handleObj,
					ret;

				// For pointerenter/pointerleave call the handler if `relatedTarget` is outside `target`.
				// Note that there is no `relatedTarget` if the pointer left/entered the browser window
				// or if the event was synthesized as part of interaction with a device that does not
				// support hover state.
				if ( !related || ( related !== target && !jQuery.contains( target, related ))) {
					event.type = handleObj.origType;
					ret = handleObj.handler.apply( target, arguments );
					event.type = fix;
				}

				return ret;
			}
		};
	});


	// If pointer events are natively supported, then we only ensure that
	// the correct properties are copied over onto jQuery's event object
	// using `jQuery.event.fixHooks` entries.
	if ( window.navigator.pointerEnabled === true ) {

		jQuery.each([
			"pointerdown",
			"pointerup",
			"pointercancel",
			"pointermove",
			"pointerover",
			"pointerout"
		], function( _, event ) {
			jQuery.event.fixHooks[ event ] = {
				props : POINTER_PROPS
			}
		});

		return;
	}

	// In IE10 most of the pointer events are already supported under the MS vendor prefix.
	// The remaining "pointerenter" and "pointerleave" events can be polyfilled with the same
	// pattern that jQuery uses for the "mouseenter" and "mouseleave" events.
	//
	// We ensure that the correct properties are copied over onto jQuery's event object
	// using `jQuery.event.fixHooks` entries and we fix a few small compatibility issues
	// with the official W3C specification for pointer events.
	if ( window.navigator.msPointerEnabled === true ) {

		jQuery.each({
			"pointerdown"   : "MSPointerDown",
			"pointerup"     : "MSPointerUp",
			"pointercancel" : "MSPointerCancel",
			"pointermove"   : "MSPointerMove",
			"pointerover"   : "MSPointerOver",
			"pointerout"    : "MSPointerOut"
		}, function( original, fix ) {
			jQuery.event.special[ original ] = {
				bindType     : fix,
				delegateType : fix,
				handle       : function( event ) {
					var
						target    = this,
						handleObj = event.handleObj,
						ret;

					event.type = handleObj.origType;
					ret = handleObj.handler.apply( target, arguments );
					event.type = fix;
					
					return ret;
				}
			};

			jQuery.event.fixHooks[ fix ] = {
				props  : POINTER_PROPS,
				filter : function( event, originalEvent ) {
					// IE10 reports the pointerType as a Number instead of a String.
					// see: http://msdn.microsoft.com/en-us/library/ie/hh772359%28v=vs.85%29.aspx
					event.pointerType = ({
						"2" : "touch", "3" : "pen", "4" : "mouse"
					}[ originalEvent.pointerType ]) || originalEvent.pointerType;

					// IE10 does not report a 0.5 pessure for active contact.
					// see: http://msdn.microsoft.com/en-us/library/ie/hh772360%28v=vs.85%29.aspx
					event.pressure = originalEvent.pressure || ( event.buttons ? 0.5 : 0 );

					return event;
				}
			}
		});
		
		// Have to redefine the "pointerenter" and "pointerleave" events in terms of
		// the MS-prefixed pointer events for jQuery's simple special binding to pick
		// them up.
		jQuery.each({
			"pointerenter" : "MSPointerOver",
			"pointerleave" : "MSPointerOut"
		}, function( original, fix ) {
			jQuery.event.special[ original ].bindType     = fix;
			jQuery.event.special[ original ].delegateType = fix;
		});

		return;
	}


	var PointerProxy = function( document ) {
		var me = this;

		me._document       = document;
		me._refCounters    = { all : 0 };
		me._activePointers = { length : 0 };

		// When the current browser does not support touch events, override the behavior
		// of the `_isSimulatedMouseEvent` function to immediately return and save some
		// CPU cycles.
		if ( document.ontouchstart === undefined ) {
			me._isSimulatedMouseEvent = function( event ) { return false; };
		}
	}

	jQuery.extend( PointerProxy, {

		/**
		 * Tracks recent touchstart events to detect and discard simulated mouse events.
		 */
		recentTouchStarts : [],

		/**
		 * Maps pointer events to their requisite mouse and touch events.
		 */
		typemap : {
			"pointerdown" : {
				"mousedown"  : "_proxyMouseEvent",
				"touchstart" : "_proxyTouchStartEvent"
			},
			"pointerup" : {
				"mouseup"  : "_proxyMouseEvent",
				"touchend" : "_proxyTouchEndEvent"
			},
			"pointermove" : {
				"mousemove"   : "_proxyMouseEvent",
				"touchstart"  : "_proxyTouchStartEvent",
				"touchmove"   : "_proxyTouchMoveEvent",
				"touchend"    : "_proxyTouchEndEvent"
			},
			"pointerover" : {
				"mouseover"  : "_proxyMouseEvent",
				"touchstart" : "_proxyTouchStartEvent",
				"touchmove"  : "_proxyTouchMoveEvent"
			},
			"pointerout" : {
				"mouseout"    : "_proxyMouseEvent",
				"touchmove"   : "_proxyTouchMoveEvent",
				"touchend"    : "_proxyTouchEndEvent",
				"touchcancel" : "_proxyTouchCancelEvent"
			},
			"pointercancel" : {
				"touchcancel" : "_proxyTouchCancelEvent"
			}
		},

		/**
		 * Binds proxying behavior for the specified pointer event to the specified document,
		 * creating a new `PointerProxy` instance on the document if necessary.
		 */
		bind : function( document, type ) {
			var me = this,
				data = jQuery.data( document ),
				pointers;

			if ( !( data.__pointerproxy instanceof PointerProxy )) {
				data.__pointerproxy = new PointerProxy( document );
			}

			data.__pointerproxy.bind( type );
		},

		/**
		 * Unbinds proxying behavior for the specified pointer event from the specified document,
		 * removing the reference to the existing `PointerProxy` instance if possible, to allow
		 * garbage collection.
		 */
		unbind : function( document, type ) {
			var me = this,
				data = jQuery.data( document ),
				pointers;

			if ( data.__pointerproxy instanceof PointerProxy ) {
				data.__pointerproxy.unbind( type );
				if ( data.__pointerproxy.isBound()) {
					delete data.__pointerproxy;
				}
			}
		}
	});

	PointerProxy.prototype = {
		constructor : PointerProxy,

		/**
		 * Determines whether the current `PointerProxy` instance has any bound event handlers.
		 * @return {boolean} `true` when any event handlers are currently bound to the proxy; otherwise, `false`.
		 */
		isBound : function() {
			return ( this._refCounters.all === 0 );
		},

		/**
		 * Binds the specified pointer event type through the current `PointerProxy` instance.
		 * @param {string} type The pointer event type to bind.
		 */
		bind : function( type ) {
			var me = this,
				refCounters = me._refCounters;

			refCounters[ type ] = ( refCounters[ type ] || 0 ) + 1;
			refCounters.all += 1;

			jQuery.each( PointerProxy.typemap[ type ], function( type, handler ) {
				// Only bind if not yet bound.
				if ( !refCounters[ type ]) {
					refCounters[ type ] = 0;
					jQuery.event.add( me._document, type, jQuery.proxy( me[ handler ], me ), null, null );
				}

				refCounters[ type ] += 1;
			});
		},

		/**
		 * Unbinds the specified pointer event type from the current `PointerProxy` instance.
		 * @param {string} type The pointer event type to unbind.
		 */
		unbind : function( type ) {
			var me = this,
				refCounters = me._refCounters;

			if ( refCounters[ type ]) {
				refCounters[ type ] -= 1;
				refCounters.all -= 1;
			}

			jQuery.each( PointerProxy.typemap[ type ], function( type, handler ) {
				if ( !refCounters[ type ]) { return; }
				
				if ( refCounters[ type ] === 1 ) {
					jQuery.event.remove( me._document, type, me[ handler ], null, null );
				}

				refCounters[ type ] -= 1;
			});
		},

		_proxyMouseEvent : function( event ) {
			var me = this,
				pointerType = event.type.replace( /^mouse/, "pointer" ),
				pointerEvent;

			// Only dispatch a pointer event when handlers are bound for it to save CPU cycles
			// and don't process simulated mouse events originating from earlier touchstart events.
			if ( me._shouldDispatch( pointerType ) && !me._isSimulatedMouseEvent( event )) {

				pointerEvent = this._wrapMouseEvent( event, {
					type          : pointerType,
					relatedTarget : event.relatedTarget
				});

				jQuery.event.trigger( pointerEvent, null, event.target, false );
			}
		},

		_proxyTouchStartEvent : function( event ) {
			var me = this,
				nativeEvent = me._getNativeEvent( event );

			// Deal with incomplete events injected from JavaScript.
			if ( nativeEvent.changedTouches == null ) return;

			jQuery.each( nativeEvent.changedTouches, function( _ , touch ) {
				var
					recent = PointerProxy.recentTouchStarts,
					pointer = me._trackPointer( touch ),
					pointerEvent;

				// Only dispatch a pointer event when handlers are bound for it to save CPU cycles.
				if ( me._shouldDispatch( "pointerdown" )) {
					pointerEvent = me._wrapTouchEvent( event, touch, {
						type          : "pointerdown",
						relatedTarget : null
					});

					jQuery.event.trigger( pointerEvent, null, touch.target, false );
				}

				if ( me._shouldDispatch( "pointerover" )) {
					pointerEvent = me._wrapTouchEvent( event, touch, {
						type          : "pointerover",
						relatedTarget : null
					});

					jQuery.event.trigger( pointerEvent, null, touch.target, false );
				}

				// Keep track of touchstart events for a short time. They are used
				// to discard their accompanying simulated mouse events that may
				// occur at up to 1.5 seconds later.
				recent.push( touch );
				setTimeout( function () {
					var index = jQuery.inArray( recent, touch );
					if ( index !== -1 ) { recent.splice( index, 1 ); }
				}, 1550 );
			});
		},

		_proxyTouchMoveEvent : function( event ) {
			var me = this,
				nativeEvent = me._getNativeEvent( event );

			// Deal with incomplete events injected from JavaScript.
			if ( nativeEvent.changedTouches == null ) return;

			jQuery.each( nativeEvent.changedTouches, function( _ , touch ) {
				var
					previousTarget,
					actualTarget,
					pointerEvent,
					pointer;

				// Only dispatch a pointer event when handlers are bound for it to save CPU cycles.
				if ( me._shouldDispatch([ "pointermove", "pointerover", "pointerout" ])) {

					pointer      = me._fetchOrTrackPointer( touch );
					actualTarget = me._getActualTouchTarget( touch );

					// If the target remains the same, only dispatch a "pointermove" event (or nothing
					// if no handler is bound).
					if ( pointer.target === actualTarget ) {

						if ( me._shouldDispatch( "pointermove" )) {
							pointerEvent = me._wrapTouchEvent( event, touch, {
								type          : "pointermove",
								relatedTarget : null
							});

							jQuery.event.trigger( pointerEvent , null, actualTarget, false );
						}

						return;
					}

					// If the event target has changed, track the updated target. When relevant handlers are
					// bound, dispatch "pointerover", "pointermove" and "pointerout" events in that order.
					previousTarget = pointer.target;
					pointer.target = actualTarget;

					if ( me._shouldDispatch( "pointerout" )) {
						pointerEvent = me._wrapTouchEvent( event, touch, {
								type          : "pointerout",
								relatedTarget : actualTarget
							});

						jQuery.event.trigger( pointerEvent , null, previousTarget, false );
					}

					if ( me._shouldDispatch( "pointermove" )) {
						pointerEvent = me._wrapTouchEvent( event, touch, {
							type          : "pointermove",
							relatedTarget : null
						});

						jQuery.event.trigger( pointerEvent , null, actualTarget, false );
					}

					if ( me._shouldDispatch( "pointerover" )) {
						pointerEvent = me._wrapTouchEvent( event, touch, {
								type          : "pointerover",
								relatedTarget : previousTarget
							});

						jQuery.event.trigger( pointerEvent , null, actualTarget, false );
					}
				}
			});
		},

		_proxyTouchEndEvent : function( event ) {
			var me = this,
				nativeEvent = me._getNativeEvent( event );

			// Deal with incomplete events injected from JavaScript.
			if ( nativeEvent.changedTouches == null ) return;

			jQuery.each( nativeEvent.changedTouches, function( _ , touch ) {
				var
					actualTarget = null,
					pointerEvent;

				// Only dispatch a pointer event when handlers are bound for it to save CPU cycles.
				if ( me._shouldDispatch( "pointerup" )) {
				
					// A "touchend" event is always dispatched from the same element on which
					// its corresponding "touchstart" event was dispatched. Pointer events
					// should dispatch from the actual target under the touch point.
					actualTarget = actualTarget || me._getActualTouchTarget( touch );

					pointerEvent = me._wrapTouchEvent( event, touch, {
						type          : "pointerup",
						relatedTarget : null
					});

					jQuery.event.trigger( pointerEvent , null, actualTarget, false );
				}

				if ( me._shouldDispatch( "pointerout" )) {
					// A "touchend" event is always dispatched from the same element on which
					// its corresponding "touchstart" event was dispatched. Pointer events
					// should dispatch from the actual target under the touch point.
					actualTarget = actualTarget || me._getActualTouchTarget( touch );

					pointerEvent = me._wrapTouchEvent( event, touch, {
						type          : "pointerout",
						relatedTarget : null
					});

					jQuery.event.trigger( pointerEvent, null, actualTarget, false );
				}

				me._untrackPointer( touch );
			});
		},

		_proxyTouchCancelEvent : function( event ) {
			var me = this,
				nativeEvent = me._getNativeEvent( event );

			// Deal with incomplete events injected from JavaScript.
			if ( nativeEvent.changedTouches == null ) return;

			jQuery.each( nativeEvent.changedTouches, function( _, touch ) {
				var
					actualTarget = null,
					pointerEvent;

				// Only dispatch a pointer event when handlers are bound for it to save CPU cycles.
				if ( me._shouldDispatch( "pointercancel" )) {
				
					// A "touchend" event is always dispatched from the same element on which
					// its corresponding "touchstart" event was dispatched. Pointer events
					// should dispatch from the actual target under the touch point.
					actualTarget = actualTarget || me._getActualTouchTarget( touch );
					
					pointerEvent = me._wrapTouchEvent( event, touch, {
						type          : "pointercancel",
						relatedTarget : null
					});

					jQuery.event.trigger( pointerEvent , null, actualTarget, false );
				}

				if ( me._shouldDispatch( "pointerout" )) {
					// A "touchend" event is always dispatched from the same element on which
					// its corresponding "touchstart" event was dispatched. Pointer events
					// should dispatch from the actual target under the touch point.
					actualTarget = actualTarget || me._getActualTouchTarget( touch );

					pointerEvent = me._wrapTouchEvent( event, touch, {
						type          : "pointerout",
						relatedTarget : null
					});

					jQuery.event.trigger( pointerEvent, null, actualTarget, false );
				}

				me._untrackPointer( touch );
			});
		},
		
		_trackPointer : function( touch ) {
			var me = this,
				pointer;

			if ( me._activePointers[ touch.identifier ]) {
				me._activePointers.length -= 1;
			}

			pointer = {
				target    : touch.target,
				isPrimary : ( me._activePointers.length === 0 )
			};

			me._activePointers[ touch.identifier ] = pointer;
			me._activePointers.length += 1;

			return pointer;
		},
		
		_fetchOrTrackPointer : function( touch ) {
			var me = this,
				pointer;

			if ( pointer = me._activePointers[ touch.identifier ]) {
				return pointer;
			}

			return me._trackPointer( touch );
		},

		_untrackPointer : function( touch ) {
			var me = this;

			if ( me._activePointers[ touch.identifier ]) {
				delete me._activePointers[ touch.identifier ];
				me._activePointers.length -= 1;
			}
		},

		_isSimulatedMouseEvent : function( event ) {
			var
				recent = PointerProxy.recentTouchStarts,
				threshold = 20,
				touch,
				n;

			for ( n = recent.length ; --n !== -1 ; ) {
				touch = recent[ n ];

				// The coordinates for the touchstart event and the corresponding simulated
				// mouse event may have coordinates that do not match exactly.
				if (
					   Math.abs( event.clientX - touch.clientX ) < threshold
					&& Math.abs( event.clientY - touch.clientY ) < threshold
				) {
					return true;
				}
			}
		},

		_getActualTouchTarget : function( touch ) {
			return touch.target.ownerDocument.elementFromPoint( touch.clientX, touch.clientY );
		},

		_wrapMouseEvent : function ( event, props ) {
			var me = this,
				nativeEvent = me._getNativeEvent( event ),
				buttons,
				button,
				pressure;

			// Normalize button and buttons. Chorded buttons make this different from regular mouse
			// button normalization.
			if ( nativeEvent.buttons !== undefined ) {
				buttons =  nativeEvent.buttons;
				button  = !nativeEvent.buttons ? -1 : nativeEvent.button;
			} else if ( event.which === 0 ) {
				button  = -1;
				buttons = 0;
			} else {
				button  = nativeEvent.button;
				buttons = BUTTONS_MAP[ button ];
			}

			// Pressure reads as 0.5 if any button is pressed and as 0 if no buttons are pressed, unless
			// pressure is explicitly reported by the native event.
			pressure = nativeEvent.pressure || nativeEvent.mozPressure || ( buttons !== 0 ? 0.5 : 0 );

			jQuery.extend( props, {
				button        : button,
				buttons       : buttons,
				pointerId     : 1,
				pointerType   : "mouse",
				width         : 0,
				height        : 0,
				pressure      : pressure,
				tiltX         : 0,
				tiltY         : 0,
				isPrimary     : true
			});

			return me._wrapEvent( event, props );
		},

		_wrapTouchEvent : function ( event, touch, props ) {
			var me = this;

			jQuery.extend( props, {
				button      : 0,
				buttons     : 1,
				clientX     : touch.clientX,
				clientY     : touch.clientY,
				pointerId   : touch.identifier + 2, // +2 to prevent collision between touch and mouse pointer IDs
				pointerType : "touch",
				width       : 20, // A best guess approximation of the average thickness of a human finger
				height      : 20,
				pressure    : 0.5,
				tiltX       : 0,
				tiltY       : 0,
				isPrimary   : me._activePointers[ touch.identifier ].isPrimary
			});

			return me._wrapEvent( event, props );
		},

		_wrapEvent : function( event, props ) {
			var me = this,
				wrappedEvent = new jQuery.Event( event, props ),
				nativeEvent = me._getNativeEvent( event ),
				name,
				n;

			// Copy over all the indicated properties if they are not present yet.
			// First tries for properties normalized by jQuery, then tries for the
			// native ones.
			for ( n = POINTER_PROPS.length ; --n !== -1 ; ) {
				name = POINTER_PROPS[ n ];
				if ( !( name in wrappedEvent )) {
					wrappedEvent[ name ] = ( name in event )
						? event[ name ]
						: nativeEvent[ name ];
				}
			}

			return wrappedEvent;
		},

		_getNativeEvent : function( event ) {
			// Drill down to the native event object.
			for( ; event.originalEvent != null; event = event.originalEvent ) {}
			
			return event;
		},

		_shouldDispatch : function( type ) {
			var me = this,
				ret;

			if ( jQuery.isArray( type )) {

				jQuery.each( type, function( _ , type ) {
					ret = !!( me._refCounters[ type ]);
					return !ret;
				});

				return ret;
			}

			return !!( me._refCounters[ type ]);
		}
	}

	jQuery.each([
		"pointerdown",
		"pointerup",
		"pointercancel",
		"pointermove",
		"pointerover",
		"pointerout"
	], function( _, original ) {

		jQuery.event.special[ original ] = {
			setup : function( data, namespaces, eventHandle ) {
				PointerProxy.bind( this.ownerDocument || this, original );
				return true;
			},

			teardown : function() {
				PointerProxy.unbind( this.ownerDocument || this, original );
				return true;
			}
		};
	});
}));