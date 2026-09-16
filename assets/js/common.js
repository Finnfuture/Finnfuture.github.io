/**
*	Luique - Personal Portfolio HTML Template
*	Version: 1.0
*	Author: bslthemes
*	Author URL: http://themeforest.net/user/bslthemes
*	Copyright © Luique by bslthemes. All Rights Reserved.
**/

( function( $ ) {
	'use strict';

/**
	Preloader
**/
$(window).on("load", function() {
	$('body').imagesLoaded( {}, function() {
		var preload = $('.preloader');
		preload.addClass('loaded');
		preload.find('.centrize').fadeOut();

		/**
			init Cursor
		**/
		initCursor();

		/**
			init Scrolla
		**/
		$('.scroll-animate').scrolla({
			once: true,
			mobile: true
		});

	});
});

$(function() {
	'use strict';

	/**
		Sections full height
	**/
	setHeightFullSection();
	$(window).resize(function() {
		setHeightFullSection();
	});

	/**
		Block Line
	**/
	if ($('.v-line').length) {
		$('.v-line .container').append('<div class="v-line-block"><span></span></div>');
		$('.v-line .hero-started').append('<div class="v-line-block"><span></span></div>');
	}

	/**
		Splitting
	**/
	Splitting();

	/**
		Header Sticky
	**/
	if($('.header').length) {
		$(window).on('scroll', function(event){

			if ( $(window).scrollTop() > 100 ) {
				$('.header').addClass('sticky');
				if ( this.oldScroll < this.scrollY ) {
					$('.header').addClass('animate-in');
				} else {
					if ( $(window).scrollTop() < 200 ) {
						$('.header').addClass('animate-out');
					}
				}
			} else {
				$('.header').removeClass('sticky');
				$('.header').removeClass('animate-in');
				$('.header').removeClass('animate-out');
			}

			this.oldScroll = this.scrollY;
		});
	}

	/**
		Header Switcher Button
	**/
	var skin = $.cookie('skin');
	if ( skin == 'light' ) {
		$('body').removeClass('dark-skin');
		$('body').addClass('light-skin');
	}
	if ( skin == 'dark' ) {
		$('body').removeClass('light-skin');
		$('body').addClass('dark-skin');
	}

	if ( $('body').hasClass('dark-skin') ) {
		$('.header .switcher-btn').addClass('active');
	}
	$('.header').on('click', '.switcher-btn', function(){
		if($(this).hasClass('active')) {
			$(this).removeClass('active');
			$('body').removeClass('dark-skin');
			$('body').addClass('light-skin');
			$.cookie('skin', 'light', { expires: 7, path: '/' });
		}
		else {
			$(this).addClass('active');
			$('body').removeClass('light-skin');
			$('body').addClass('dark-skin');
			$.cookie('skin', 'dark', { expires: 7, path: '/' });
		}
		return false;
	});

	/**
		Header Menu Button
	**/
	$('.header').on('click', '.menu-btn', function(){
		if($(this).hasClass('active')) {
			$(this).removeClass('active');
			$(this).addClass('no-touch');
			$('.menu-overlay').addClass('no-touch');
			$('body').removeClass('no-scroll');
			$('.menu-full-overlay').removeClass('is-open');
			$('.menu-full-overlay').removeClass('has-scroll');
			$('.menu-full-overlay').removeClass('animate-active');
			setTimeout(function(){
				$('.menu-full-overlay').removeClass('visible');
				$('.menu-btn').removeClass('no-touch');
				$('.menu-overlay').removeClass('no-touch');
			}, 1000);
		}
		else {
			$(this).addClass('active no-touch');
			$('.menu-overlay').addClass('no-touch');
			var height = $(window).height();
			$('.menu-full-overlay').css({'height': height});
			$('body').addClass('no-scroll');
			$('.menu-full-overlay').addClass('is-open visible');
			setTimeout(function(){
				$('.menu-full-overlay').addClass('has-scroll animate-active');
				$('.menu-btn').removeClass('no-touch');
				$('.menu-overlay').removeClass('no-touch');
			}, 1000);
		}
		return false;
	});
	$('.menu-full-overlay').on('click', '.menu-overlay', function(){
		$('.menu-btn').removeClass('active');
		$('.menu-btn').addClass('no-touch');
		$('.menu-overlay').addClass('no-touch');
		$('body').removeClass('no-scroll');
		$('.menu-full-overlay').removeClass('is-open');
		$('.menu-full-overlay').removeClass('has-scroll');
		$('.menu-full-overlay').removeClass('animate-active');
		setTimeout(function(){
			$('.menu-full-overlay').removeClass('visible');
			$('.menu-btn').removeClass('no-touch');
			$('.menu-overlay').removeClass('no-touch');
		}, 1000);
		return false;
	});

	/*
		Top Menu
	*/
	$('.menu-full').on('click', 'a', function(){
		$('.header .menu-btn.active').trigger('click');
	});

	/*
		Carousel Services
	*/
	if (typeof Swiper !== 'undefined' && $('.js-services').length) {
		new Swiper('.js-services', {
			slidesPerView: 3,
			spaceBetween: 40,
			watchSlidesVisibility: true,
			noSwipingSelector: 'a',
			loop: false,
			speed: 1000,
			pagination: {
				el: '.swiper-pagination',
				type: 'bullets',
				clickable: true,
			},
			navigation: false,
			breakpoints: {
				// when window width is >= 320px
				0: {
					slidesPerView: 1,
					spaceBetween: 20
				},
				// when window width is >= 480px
				767: {
					slidesPerView: 2,
					spaceBetween: 30
				},
				// when window width is >= 640px
				1024: {
					slidesPerView: 3,
					spaceBetween: 40
				}
			}
		});
	}

	/**
		Collapse
	**/
	$('.lui-collapse-item').on('click', '.lui-collapse-btn', function(){
		if($(this).closest('.lui-collapse-item').hasClass('opened')) {
			$(this).closest('.lui-collapse-item').removeClass('opened');
			$(this).removeClass('active');
		}
		else {
			$(this).closest('.lui-collapse-item').addClass('opened');
			$(this).addClass('active');
		}
	});


});

function initCursor() {
	var mouseX=window.innerWidth/2, mouseY=window.innerHeight/2;

	var cursor = {
		el: $('.cursor'),
		x: window.innerWidth/2,
		y: window.innerHeight/2,
		w: 30,
		h: 30,
		update:function() {
			var l = this.x-this.w/2;
			var t = this.y-this.h/2;
			this.el.css({ 'transform':'translate3d('+l+'px,'+t+'px, 0)' });
		}
	}

	$(window).mousemove (function(e) {
		mouseX = e.clientX;
		mouseY = e.clientY;
	});

	$('a, .swiper-pagination, button, .btn, .lnk').hover(function() {
		$('.cursor').addClass("cursor-zoom");
	}, function(){
		$('.cursor').removeClass("cursor-zoom");
	});

	setInterval(move,1000/60);

	function move() {
		cursor.x = lerp (cursor.x, mouseX, 0.1);
		cursor.y = lerp (cursor.y, mouseY, 0.1);
		cursor.update()
	}

	function lerp (start, end, amt) {
		return (1-amt)*start+amt*end
	}

}

function setHeightFullSection() {
	var height = $(window).height();

	/* Set full height in started blocks */
	$('.menu-full-overlay, .preloader .centrize').css({'height': height});
}

/**
	WeChat QR Popup
**/
function showWeChatQR() {
	var mask = document.createElement('div');
	mask.style.position = 'fixed';
	mask.style.left = 0;
	mask.style.top = 0;
	mask.style.width = '100vw';
	mask.style.height = '100vh';
	mask.style.background = 'rgba(0,0,0,0.6)';
	mask.style.zIndex = 9999;
	mask.onclick = function() { document.body.removeChild(mask); };

	var img = document.createElement('img');
	img.src = 'assets/images/wechat.jpg';
	img.style.position = 'absolute';
	img.style.top = '50%';
	img.style.left = '50%';
	img.style.transform = 'translate(-50%, -50%)';
	img.style.maxWidth = '80vw';
	img.style.maxHeight = '80vh';
	img.style.boxShadow = '0 4px 32px rgba(0,0,0,0.3)';
	img.style.borderRadius = '8px';
	mask.appendChild(img);

	document.body.appendChild(mask);
}

} )( jQuery );
