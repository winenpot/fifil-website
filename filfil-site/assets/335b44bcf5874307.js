$(document).ready(function () {
    //select lang
    $('.header-box__r_langlist > li > a').click(function () {
        $(this).toggleClass('chng');
        $(this).siblings('.submenu-flag').toggleClass('show');

    });
    //header-fix
    var headHeight = 1,
        fixmenu = $('header');
    //_Main = $('.main').width();
    $(window).on("scroll", function () {

        if ($(this).scrollTop() > headHeight) { fixmenu.addClass('scroll-down'); }
        else { fixmenu.removeClass('scroll-down'); }
    });
    //slider
    var sliders = new Swiper('.slider', {
        pagination: {
            el: '.swiper-pagination',
        },
        autoplay: {
            delay: 5000,
            disableOnInteraction: false
        },
        effect: 'fade',
    });
    //control inside slider
    if ($(".slider-section").length === 1) {
        $('.inbody').removeClass('pd');
    } else {
        $('.inbody').addClass('pd');
    }
    //video

    $('.playbtn').click(function () {
        var thisvideo = $(this).parent().find('video')[0];
        $(this).fadeOut();
        $(this).parent().addClass('show');
        $(this).siblings('video')[0].play();
        $(this).siblings('video').on("ended", function () {
            $(this).parent().find('video')[0].load();
            $('.playbtn').fadeIn();
            $('.playbtn').parent().removeClass('show');
            thisvideo.removeAttribute("controls");
        });
        if (thisvideo.hasAttribute("controls")) { thisvideo.removeAttribute("controls"); }
        else { thisvideo.setAttribute("controls", "controls"); }
    });
    //tab
    $("[data-tab]").click(function (e) {
        e.preventDefault();
        let Href = $(this).attr("href");
        let parentSlide = $(this).parents("[data-Ptab]");
        parentSlide.find("[data-tab]").removeClass("active");
        $(this).addClass("active");
        let parent = $(this).parents("[data-parent]");
        parent.find("[data-Tlist]").removeClass("active");
        parent.find(Href).addClass("active");
    });
    /*** popup ***/
    $('[data-popup]').click(function (e) {
        var DataPopUp = $(this).data('popup');
        if (DataPopUp != '' && DataPopUp != null) {
            e.preventDefault();
            $('.bodyglas').addClass('showing');
            $(".popupOverlay." + DataPopUp).addClass("is-active");
        }
    });
    $('.bodyglas').click(function () { $('.popupOverlay').removeClass('is-active'); $('.bodyglas').removeClass('showing'); });
    $('.popup-close').click(function () {
        //$('body').removeClass("fixbody");
        $('.popupOverlay').removeClass('is-active');
        $('.bodyglas').removeClass('showing');
    });
    $(document).keydown(function (e) {
        if (e.keyCode == 27) {
            $('.popupOverlay').removeClass('is-active');
            $('.bodyglas').removeClass('showing');
        }
    });
/*** popup end ***/
});
$(window).on('load', function () {
    if ($(window).scrollTop() > 0) {
        $('header').addClass('scroll-down');

    }
    else { $('header').removeClass('scroll-down'); }
});


		