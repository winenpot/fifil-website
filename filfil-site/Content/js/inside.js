//history slider
var historyslidertumb = new Swiper('.history_slider_tumb', {
        slidesPerView:7,
        watchSlidesVisibility: true,
    watchSlidesProgress: true,
    
    });
var historyslidergallery = new Swiper('.history_slider_gallery', {
        slidesPerView: 1,
        speed:1000,
        fadeEffect: {
            crossFade: true
        },
        autoplay: {
            delay: 6000,
            disableOnInteraction: false
        },

        navigation: {
            nextEl: '.history_slider-next',
            prevEl: '.history_slider-prev',
        },
        thumbs: {
            swiper: historyslidertumb
        },
});
//Detail gallery slider
var productsdetailgallerybottom = new Swiper('.products-detail__gallerybottom', {
    slidesPerView:3,
    watchSlidesVisibility: true,
    watchSlidesProgress: true,
    spaceBetween: 25,
});
var productsdetailgallerytop = new Swiper('.products-detail__gallerytop', {
    slidesPerView: 1,
    speed: 1000,
    fadeEffect: {
        crossFade: true
    },
    navigation: {
        nextEl: '.products-detail-next',
        prevEl: '.products-detail-prev',
    },
    thumbs: {
        swiper: productsdetailgallerybottom
    },
    on: {
        transitionStart: function () {
            zoomImg();
        },
    }
});

//zoom img
zoomImg();

function zoomImg() {
    var img = '';
    if ($('.products-detail__gallerybottom .swiper-slide-thumb-active figure').hasClass('video-item')) {
        $('.zoom-img').addClass('zoom-disable');
    } else {
        img = $('.products-detail__gallerybottom .swiper-slide-thumb-active figure img').attr('src');
        $('.zoom-img').removeClass('zoom-disable');
    }
    $('.zoom-img img').attr('src', img);
}

var scale = 1.5;
var img = $('.zoom-img img');
var zoomW = parseFloat($('.zoom-img').css('width'));
var zoomH = parseFloat($('.zoom-img').css('height'));
var imgW;
var imgH;
$('.zoom-img').mouseover(function () {
    // galleryTop.autoplay.stop();
    imgW = parseFloat(img.css('width')) * scale;
    imgH = parseFloat(img.css('height')) * scale;
    img.css({
        'width': imgW + 'px',
        'height': imgH + 'px'
    });
    imgW -= zoomW;
    imgH -= zoomH;
    $(this).addClass('active');
}).mouseleave(function () {
    // galleryTop.autoplay.start();
    img.removeAttr('style');
    $(this).removeClass('active');
}).mousemove(function (e) {
    var x = -(e.offsetX * imgW / zoomW);
    var y = -(e.offsetY * imgH / zoomH);
    img.css({
        'transform': 'translate(' + x + 'px, ' + y + 'px)',
    });
});



